import {cleanup,render,screen,waitFor} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {apiClient,ApiClientError} from "@/lib/api/client";
import {allScreens} from "@/lib/prototype/registry";
import type {Role} from "@/lib/prototype/types";
import {ScreenHost} from "./ScreenHost";

let pathname="/";
const router={push:vi.fn(),replace:vi.fn(),refresh:vi.fn()};

vi.mock("next/navigation",()=>({usePathname:()=>pathname,useRouter:()=>router}));
vi.mock("@/features/web/Experience",()=>({WebExperience:({kind}:{kind:string})=><section><h1>{kind}</h1></section>}));
vi.mock("@/components/shell/AppShell",()=>({AppShell:({children,organizationName,branchName}:{children:React.ReactNode;organizationName?:string;branchName?:string})=><main><span>{organizationName}</span><span>{branchName}</span>{children}</main>}));

function viewer(roles:Role[],featureFlags:Record<string,boolean>={content_approval:true,team_analytics:true}){return{id:"member",displayName:"匿名利用者",organizationName:"華丸買取サービス",branchName:"東京中央店",roles,capabilities:[],featureFlags};}

afterEach(()=>{cleanup();vi.restoreAllMocks();pathname="/";});

describe("authenticated production routes",()=>{
  it.each(allScreens)("renders $id from the roles returned by /me",async definition=>{
    pathname=definition.routes[0].replace(":id","90a87e28-aeda-4303-90af-1d06769076c1");
    vi.spyOn(apiClient,"request").mockResolvedValue(viewer([definition.roles[0]]));
    render(<ScreenHost/>);
    expect(await screen.findByRole("heading",{name:definition.kind})).toBeInTheDocument();
  });

  it("does not accept a query role override",async()=>{
    pathname="/admin/users?role=manager".split("?")[0]!;
    vi.spyOn(apiClient,"request").mockResolvedValue(viewer(["assessor"]));
    render(<ScreenHost/>);
    expect(await screen.findByRole("heading",{name:"この画面を利用する権限がありません"})).toBeInTheDocument();
  });

  it("passes the organization and branch returned by /me to the shell",async()=>{
    pathname="/visits";
    vi.spyOn(apiClient,"request").mockResolvedValue(viewer(["assessor"]));
    render(<ScreenHost/>);
    expect(await screen.findByText("華丸買取サービス")).toBeInTheDocument();
    expect(screen.getByText("東京中央店")).toBeInTheDocument();
  });

  it("authorizes the screen from the viewer returned by /me",async()=>{
    pathname="/visits";
    const request=vi.spyOn(apiClient,"request").mockResolvedValue(viewer(["assessor"]));
    render(<ScreenHost/>);
    expect(await screen.findByRole("heading",{name:"visitList"})).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith("/me");
  });

  it("uses server feature flags and never a feature query",async()=>{
    pathname="/admin/approvals";
    vi.spyOn(apiClient,"request").mockResolvedValue(viewer(["content_approver"],{content_approval:false,team_analytics:false}));
    render(<ScreenHost/>);
    expect(await screen.findByRole("heading",{name:"コンテンツ承認は現在利用できません"})).toBeInTheDocument();
  });

  it("keeps a system-admin-only account out of visit and AI content",async()=>{
    pathname="/visits";
    vi.spyOn(apiClient,"request").mockResolvedValue(viewer(["system_admin"]));
    render(<ScreenHost/>);
    expect(await screen.findByRole("heading",{name:"この画面を利用する権限がありません"})).toBeInTheDocument();
  });

  it("keeps a mixed system-admin account out of visit and AI content",async()=>{
    pathname="/visits";
    vi.spyOn(apiClient,"request").mockResolvedValue(viewer(["system_admin","manager","educator"]));
    render(<ScreenHost/>);
    expect(await screen.findByRole("heading",{name:"この画面を利用する権限がありません"})).toBeInTheDocument();
  });

  it("allows a mixed system-admin account to use only the management-only operations screen",async()=>{
    pathname="/admin/operations";
    vi.spyOn(apiClient,"request").mockResolvedValue(viewer(["system_admin","manager"]));
    render(<ScreenHost/>);
    expect(await screen.findByRole("heading",{name:"operations"})).toBeInTheDocument();
  });

  it("sends an expired Identity Platform token to the login recovery path",async()=>{
    pathname="/visits";
    vi.spyOn(apiClient,"request").mockRejectedValue(new ApiClientError(401,"AUTH_REQUIRED","expired"));
    render(<ScreenHost/>);
    expect(await screen.findByRole("heading",{name:"ログインが必要です"})).toBeInTheDocument();
    await waitFor(()=>expect(screen.getByRole("link",{name:"ログインへ進む"})).toHaveAttribute("href","/login"));
  });
});
