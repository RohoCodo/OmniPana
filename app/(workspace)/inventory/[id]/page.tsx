import { ProductDetail } from "@/components/inventory";
export const metadata = { title: "Product detail" };
export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <ProductDetail id={id} />; }