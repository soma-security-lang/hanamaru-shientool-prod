import {act,cleanup,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const state=vi.hoisted(()=>({pathname:"/",request:vi.fn()}));
vi.mock("next/navigation",()=>({usePathname:()=>state.pathname}));
vi.mock("@/lib/api/client",()=>({apiClient:{request:state.request},ApiClientError:class extends Error{status=401;}}));
import {ViewerProvider,useViewer} from "./ViewerProvider";
function Consumer(){const {authState,viewer}=useViewer();return <output data-testid="viewer">{authState}:{viewer?.displayName??"none"}</output>;}
beforeEach(()=>{state.request.mockReset();state.request.mockResolvedValue({id:"synthetic",displayName:"合成査定員",roles:["assessor"],capabilities:[],featureFlags:{}});});
afterEach(()=>cleanup());
describe("authentication handshakes do not race product identity reads",()=>{
  it.each(["/login","/sso/start","/sso/callback"])("waits on %s and reads identity only after reaching the product",async path=>{
    state.pathname=path;
    const view=render(<ViewerProvider><Consumer/></ViewerProvider>);
    await act(async()=>{});
    expect(state.request).not.toHaveBeenCalled();
    state.pathname="/visits";
    view.rerender(<ViewerProvider><Consumer/></ViewerProvider>);
    await waitFor(()=>expect(screen.getByTestId("viewer")).toHaveTextContent("ready:合成査定員"));
    expect(state.request).toHaveBeenCalledExactlyOnceWith("/me");
  });
  it("does not make a protected lookalike route public",async()=>{
    state.pathname="/sso/start/private";
    render(<ViewerProvider><Consumer/></ViewerProvider>);
    await waitFor(()=>expect(state.request).toHaveBeenCalledExactlyOnceWith("/me"));
  });
});
