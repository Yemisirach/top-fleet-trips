import { serviceWorkerSource } from "@/lib/service-worker-source";

export const dynamic = "force-dynamic";

export function GET() {
  return new Response(serviceWorkerSource, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Content-Type": "application/javascript; charset=utf-8",
      Expires: "0",
      Pragma: "no-cache",
      "Service-Worker-Allowed": "/",
      "Surrogate-Control": "no-store",
    },
  });
}
