import {NextRequest,NextResponse} from "next/server";

const legacyCloudRunHost="hanamaru-pilot-web-tpqjzqidwa-an.a.run.app";
const canonicalFirebaseHost="monocle-503402.firebaseapp.com";

export function proxy(request:NextRequest){
  const host=(request.headers.get("x-forwarded-host")??request.headers.get("host")??"").split(":")[0]?.toLowerCase();
  if(host!==legacyCloudRunHost)return NextResponse.next();
  const destination=request.nextUrl.clone();
  destination.protocol="https";
  destination.host=canonicalFirebaseHost;
  return NextResponse.redirect(destination,308);
}

export const config={matcher:"/:path*"};
