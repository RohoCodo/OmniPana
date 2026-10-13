import { CountMethod, CountSessionStatus } from "@prisma/client";
import { requireAuthorizedLocation, requireLocationRole } from "../auth";
import { decimal, ledgerQuantity, mlToBottles, positive, stored } from "../inventory/math";
import { authorizeLocation, scopedProduct, serialize, transaction, validDate } from "../inventory/shared";
import { postingKey } from "../receiving/shared";

interface CreateSessionInput {
  locationId: string;
  countedAt?: string;
  method?: CountMethod;
  notes?: string;
}

interface UpsertLineInput {
  locationId: string;
  sessionId: string;
  productId: string;
  quantityMl: string;
  confidence?: string;
  notes?: string;
  photoId?: string;
}

interface TransitionInput {
  locationId: string;
  sessionId: string;
  status: "IN_PROGRESS" | "SUBMITTED" | "REVIEWED" | "FINALIZED" | "VOIDED";
  notes?: string;
}

interface CorrectLineInput {
  locationId: string;
  sessionId: string;
  productId: string;
  quantityMl: string;
  confidence?: string;
  reason: string;
}

function canTransition(current: CountSessionStatus, next: TransitionInput["status"]): boolean {
  if (current === "VOIDED" || current === "FINALIZED") return false;
  if (current === "DRAFT") return next === "IN_PROGRESS" || next === "SUBMITTED" || next === "VOIDED";
  if (current === "IN_PROGRESS") return next === "SUBMITTED" || next === "VOIDED";
  if (current === "SUBMITTED") return next === "REVIEWED" || next === "VOIDED";
  if (current === "REVIEWED") return next === "FINALIZED" || next === "VOIDED";
  return false;
}

async function getSessionOrThrow(locationId: string, sessionId: string) {
  return transaction(async tx => {
    const session = await tx.countSession.findFirst({ where: { id: sessionId, locationId }, include: { lines: true } });
    if (!session) throw new Error("Count session not found in this location");
    return session;
  });
}

export async function createCountSession(userId: string, input: CreateSessionInput) {
  await requireAuthorizedLocation(input.locationId, userId);
  const countedAt = input.countedAt ? validDate(input.countedAt, "countedAt") : new Date();
  const notes = (input.notes ?? "").trim();
  return transaction(async tx => {
    await authorizeLocation(tx, input.locationId, userId);
    const created = await tx.countSession.create({
      data: {
        locationId: input.locationId,
        countedAt,
        method: input.method ?? "MANUAL",
        notes,
        createdBy: userId,
      },
    });
    return serialize(created);
  });
}

export async function upsertCountSessionLine(userId: string, input: UpsertLineInput) {
  await requireAuthorizedLocation(input.locationId, userId);
  const quantityMl = positive(input.quantityMl, "quantityMl");
  const confidence = decimal(input.confidence ?? "1", "confidence");
  if (confidence.lt(0) || confidence.gt(1)) throw new Error("confidence must be between 0 and 1");
  const notes = (input.notes ?? "").trim();
  return transaction(async tx => {
    await authorizeLocation(tx, input.locationId, userId);
    const session = await tx.countSession.findFirst({ where: { id: input.sessionId, locationId: input.locationId } });
    if (!session) throw new Error("Count session not found in this location");
    if (session.status === "FINALIZED" || session.status === "VOIDED") {
      throw new Error("Cannot edit a finalized or voided count session");
    }
    const product = await scopedProduct(tx, input.locationId, input.productId);
    const quantityBottles = mlToBottles(quantityMl, product.bottleSizeMl.toFixed());
    const line = await tx.countSessionLine.upsert({
      where: { sessionId_productId: { sessionId: input.sessionId, productId: input.productId } },
      create: {
        sessionId: input.sessionId,
        productId: input.productId,
        photoId: input.photoId,
        quantityMl: ledgerQuantity(quantityMl),
        quantityBottles: ledgerQuantity(quantityBottles),
        confidence: stored(confidence, 8, 4, "confidence"),
        notes,
        createdBy: userId,
      },
      update: {
        photoId: input.photoId,
        quantityMl: ledgerQuantity(quantityMl),
        quantityBottles: ledgerQuantity(quantityBottles),
        confidence: stored(confidence, 8, 4, "confidence"),
        notes,
      },
    });
    return serialize(line);
  });
}

export async function transitionCountSession(userId: string, input: TransitionInput) {
  await requireAuthorizedLocation(input.locationId, userId);
  if (input.status === "REVIEWED" || input.status === "FINALIZED" || input.status === "VOIDED") {
    await requireLocationRole(input.locationId, userId, ["MANAGER"]);
  }
  return transaction(async tx => {
    await authorizeLocation(tx, input.locationId, userId);
    const session = await tx.countSession.findFirst({
      where: { id: input.sessionId, locationId: input.locationId },
      include: { lines: true },
    });
    if (!session) throw new Error("Count session not found in this location");
    if (session.status === input.status) return { alreadyInStatus: true, session: serialize(session) };
    if (!canTransition(session.status, input.status)) {
      throw new Error(`Invalid count session transition: ${session.status} -> ${input.status}`);
    }

    if (input.status === "SUBMITTED" && session.lines.length === 0) {
      throw new Error("Cannot submit an empty count session");
    }

    const notes = input.notes?.trim();
    const now = new Date();
    const updated = await tx.countSession.update({
      where: { id: session.id },
      data: {
        status: input.status,
        notes: notes ? `${session.notes}${session.notes ? "\n" : ""}${notes}` : session.notes,
        reviewedBy: input.status === "REVIEWED" ? userId : session.reviewedBy,
        reviewedAt: input.status === "REVIEWED" ? now : session.reviewedAt,
        finalizedBy: input.status === "FINALIZED" ? userId : session.finalizedBy,
        finalizedAt: input.status === "FINALIZED" ? now : session.finalizedAt,
        voidedBy: input.status === "VOIDED" ? userId : session.voidedBy,
        voidedAt: input.status === "VOIDED" ? now : session.voidedAt,
        endedAt: input.status === "FINALIZED" || input.status === "VOIDED" ? now : session.endedAt,
      },
      include: { lines: true },
    });

    if (input.status !== "FINALIZED") return { alreadyInStatus: false, session: serialize(updated) };

    for (const line of updated.lines) {
      const product = await scopedProduct(tx, input.locationId, line.productId);
      await tx.physicalCount.create({
        data: {
          locationId: input.locationId,
          productId: line.productId,
          countSessionId: updated.id,
          photoId: line.photoId,
          quantityMl: line.quantityMl,
          quantityBottles: line.quantityBottles,
          confidence: line.confidence,
          confirmedBy: userId,
          confirmedAt: now,
          countedAt: updated.countedAt,
          varianceStatus: "REVIEW",
        },
      });
      await tx.inventoryTransaction.create({
        data: {
          locationId: input.locationId,
          productId: line.productId,
          type: "PHYSICAL_COUNT",
          quantityMl: line.quantityMl,
          quantityBottles: line.quantityBottles,
          unitCost: product.unitCost,
          source: updated.method === "PHOTO_ASSISTED" ? "AI_PHOTO" : "USER",
          sourceId: updated.id,
          notes: "Finalized count session physical observation",
          createdBy: userId,
          createdAt: updated.countedAt,
          idempotencyKey: postingKey("count-session-finalized", input.locationId, updated.id, line.productId),
        },
      });
    }

    return { alreadyInStatus: false, session: serialize(updated) };
  });
}

export async function correctFinalizedCountSessionLine(userId: string, input: CorrectLineInput) {
  await requireLocationRole(input.locationId, userId, ["MANAGER"]);
  const quantityMl = positive(input.quantityMl, "quantityMl");
  const confidence = decimal(input.confidence ?? "1", "confidence");
  if (confidence.lt(0) || confidence.gt(1)) throw new Error("confidence must be between 0 and 1");
  const reason = input.reason.trim();
  if (!reason) throw new Error("Correction reason is required");
  return transaction(async tx => {
    await authorizeLocation(tx, input.locationId, userId);
    const session = await tx.countSession.findFirst({ where: { id: input.sessionId, locationId: input.locationId } });
    if (!session) throw new Error("Count session not found in this location");
    if (session.status !== "FINALIZED") throw new Error("Only finalized count sessions can be corrected");

    const product = await scopedProduct(tx, input.locationId, input.productId);
    const line = await tx.countSessionLine.findUnique({ where: { sessionId_productId: { sessionId: session.id, productId: input.productId } } });
    if (!line) throw new Error("Count session line not found");

    const previousCount = await tx.physicalCount.findFirst({
      where: { locationId: input.locationId, productId: input.productId, countSessionId: session.id },
      orderBy: [{ countedAt: "desc" }, { confirmedAt: "desc" }, { id: "desc" }],
    });
    if (!previousCount) throw new Error("No finalized physical count exists for this line");

    const quantityBottles = mlToBottles(quantityMl, product.bottleSizeMl.toFixed());
    const now = new Date();

    const updatedLine = await tx.countSessionLine.update({
      where: { sessionId_productId: { sessionId: session.id, productId: input.productId } },
      data: {
        quantityMl: ledgerQuantity(quantityMl),
        quantityBottles: ledgerQuantity(quantityBottles),
        confidence: stored(confidence, 8, 4, "confidence"),
        notes: `${line.notes}${line.notes ? "\n" : ""}Correction: ${reason}`,
      },
    });

    const correction = await tx.countSessionCorrection.create({
      data: {
        sessionId: session.id,
        productId: input.productId,
        beforeQuantityMl: previousCount.quantityMl,
        beforeQuantityBottles: previousCount.quantityBottles,
        afterQuantityMl: updatedLine.quantityMl,
        afterQuantityBottles: updatedLine.quantityBottles,
        reason,
        correctedBy: userId,
      },
    });

    const physical = await tx.physicalCount.create({
      data: {
        locationId: input.locationId,
        productId: input.productId,
        countSessionId: session.id,
        quantityMl: updatedLine.quantityMl,
        quantityBottles: updatedLine.quantityBottles,
        confidence: updatedLine.confidence,
        confirmedBy: userId,
        confirmedAt: now,
        countedAt: session.countedAt,
        varianceStatus: "REVIEW",
      },
    });

    const transactionRow = await tx.inventoryTransaction.create({
      data: {
        locationId: input.locationId,
        productId: input.productId,
        type: "PHYSICAL_COUNT",
        quantityMl: updatedLine.quantityMl,
        quantityBottles: updatedLine.quantityBottles,
        unitCost: product.unitCost,
        source: "USER",
        sourceId: session.id,
        notes: `Count correction: ${reason}`,
        createdBy: userId,
        createdAt: session.countedAt,
        idempotencyKey: postingKey("count-session-correction", input.locationId, session.id, input.productId, correction.id),
      },
    });

    return {
      correction: serialize(correction),
      line: serialize(updatedLine),
      physical: serialize(physical),
      ledger: serialize(transactionRow),
    };
  });
}

export async function getCountSession(locationId: string, sessionId: string, userId: string) {
  await requireAuthorizedLocation(locationId, userId);
  const session = await getSessionOrThrow(locationId, sessionId);
  return serialize(session);
}

export const countSessionService = {
  createCountSession,
  upsertCountSessionLine,
  transitionCountSession,
  correctFinalizedCountSessionLine,
  getCountSession,
};

export type {
  CreateSessionInput,
  UpsertLineInput,
  TransitionInput,
  CorrectLineInput,
};
