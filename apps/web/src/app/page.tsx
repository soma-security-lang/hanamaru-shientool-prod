import { ScreenHost } from "@/components/prototype/ScreenHost";
import { Suspense } from "react";

export default function Home() {
  return <Suspense fallback={null}><ScreenHost /></Suspense>;
}
