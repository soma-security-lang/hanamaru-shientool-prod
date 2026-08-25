import {NextRequest} from "next/server";
import {describe,expect,it} from "vitest";
import {proxy} from "./proxy";

describe("canonical Firebase origin proxy",()=>{
  it("redirects the legacy Cloud Run host without leaking its internal port",()=>{
    const request=new NextRequest("https://hanamaru-pilot-web-tpqjzqidwa-an.a.run.app:8080/login?release=test",{headers:{host:"hanamaru-pilot-web-tpqjzqidwa-an.a.run.app:8080"}});
    const response=proxy(request);
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe("https://monocle-503402.firebaseapp.com/login?release=test");
  });

  it("serves the Firebase origin without redirecting",()=>{
    const request=new NextRequest("https://monocle-503402.firebaseapp.com/login",{headers:{host:"monocle-503402.firebaseapp.com"}});
    expect(proxy(request).headers.get("location")).toBeNull();
  });
});
