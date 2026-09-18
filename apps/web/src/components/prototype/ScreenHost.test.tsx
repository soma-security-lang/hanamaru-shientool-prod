import {cleanup,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {apiClient,ApiClientError} from "@/lib/api/client";
import {allScreens} from "@/lib/prototype/registry";
import type {Role} from "@/lib/prototype/types";
import {ViewerProvider} from "@/components/auth/ViewerProvider";
import {ScreenHost} from "./ScreenHost";

let pathname="/";
const router={push:vi.fn(),replace:vi.fn(),refresh:vi.fn()};

vi.mock("next/navigation",()=>({usePathname:()=>pathname,useRouter:()=>router}));
vi.mock("@/features/web/Experience",()=>({WebExperience:({kind}:{kind:string})=><section><h1>{kind}</h1></section>}));
vi.mock("@/components/shell/AppShell",()=>({AppShell:({children,organizationName,branchName}:{children:React.ReactNode;organizationName?:string;branchName?:string})=><main><span>{organizationName}</span><span>{branchName}</span>{children}</main>}));

function viewer(roles:Role[],featureFlags:Record<string,boolean>={content_approval:true,team_analytics:true,market_price_search:true}){return{id:"member",displayName:"匿名利用者",organizationName:"華丸買取サービス",branchName:"東京中央店",roles,capabilities:[],featureFlags};}
function renderHost(key="screen"){return render(<ViewerProvider><ScreenHost key={key}/></ViewerProvider>);}

afterEach(()=>{cleanup();vi.restoreAllMocks();pathname="/";});

describe("authenticated production routes",()=>{
  it.each(allScreens)("renders $id from the roles returned by /me",async definition=>{
    pathname=definition.routes[0].replace(":id","90a87e28-aeda-4303-90af-1d06769076c1");
    vi.spyOn(apiClient,"request").mockResolvedValue(viewer([definition.roles[0]]));
    renderHost();
    expect(await screen.findByRole("heading",{name:definition.kind})).toBeInTheDocument();
  });

  it("does not accept a query role override",async()=>{
    pathname="/admin/users?role=manager".split("?")[0]!;
    vi.spyOn(apiClient,"request").mockResolvedValue(viewer(["assessor"]));
    renderHost();
    expect(await screen.findByRole("heading",{name:"この画面を利用する権限がありません"})).toBeInTheDocument();
  });

  it("passes the organization and branch returned by /me to the shell",async()=>{
    pathname="/visits";
    vi.spyOn(apiClient,"request").mockResolvedValue(viewer(["assessor"]));
    renderHost();
    expect(await screen.findByText("華丸買取サービス")).toBeInTheDocument();
    expect(screen.getByText("東京中央店")).toBeInTheDocument();
  });

  it("authorizes the screen from the viewer returned by /me",async()=>{
    pathname="/visits";
    const request=vi.spyOn(apiClient,"request").mockResolvedValue(viewer(["assessor"]));
    renderHost();
    expect(await screen.findByRole("heading",{name:"visitList"})).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith("/me");
  });

  it("uses server feature flags and never a feature query",async()=>{
    pathname="/admin/approvals";
    vi.spyOn(apiClient,"request").mockResolvedValue(viewer(["content_approver"],{content_approval:false,team_analytics:false}));
    renderHost();
    expect(await screen.findByRole("heading",{name:"コンテンツ承認は現在利用できません"})).toBeInTheDocument();
  });

  it("keeps a system-admin-only account out of visit and AI content",async()=>{
    pathname="/visits";
    vi.spyOn(apiClient,"request").mockResolvedValue(viewer(["system_admin"]));
    renderHost();
    expect(await screen.findByRole("heading",{name:"この画面を利用する権限がありません"})).toBeInTheDocument();
  });

  it("keeps a mixed system-admin account out of visit and AI content",async()=>{
    pathname="/visits";
    vi.spyOn(apiClient,"request").mockResolvedValue(viewer(["system_admin","manager","educator"]));
    renderHost();
    expect(await screen.findByRole("heading",{name:"この画面を利用する権限がありません"})).toBeInTheDocument();
  });

  it("allows a mixed system-admin account to use only the management-only operations screen",async()=>{
    pathname="/admin/operations";
    vi.spyOn(apiClient,"request").mockResolvedValue(viewer(["system_admin","manager"]));
    renderHost();
    expect(await screen.findByRole("heading",{name:"operations"})).toBeInTheDocument();
  });

  it("sends an expired Identity Platform token to the login recovery path",async()=>{
    pathname="/visits";
    vi.spyOn(apiClient,"request").mockRejectedValue(new ApiClientError(401,"AUTH_REQUIRED","expired"));
    renderHost();
    expect(await screen.findByRole("heading",{name:"ログインが必要です"})).toBeInTheDocument();
    await waitFor(()=>expect(screen.getByRole("link",{name:"ログインへ進む"})).toHaveAttribute("href","/login"));
  });

  it("keeps the authenticated viewer while route pages remount",async()=>{
    pathname="/visits";
    const request=vi.spyOn(apiClient,"request").mockResolvedValue(viewer(["assessor"]));
    const view=renderHost("visits");
    expect(await screen.findByRole("heading",{name:"visitList"})).toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(1);

    pathname="/training/roleplay";
    view.rerender(<ViewerProvider><ScreenHost key="roleplay"/></ViewerProvider>);

    expect(await screen.findByRole("heading",{name:"roleplay"})).toBeInTheDocument();
    expect(screen.queryByRole("heading",{name:"利用者情報を確認しています"})).not.toBeInTheDocument();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
