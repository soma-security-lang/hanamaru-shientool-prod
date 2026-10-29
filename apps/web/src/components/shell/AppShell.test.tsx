import {cleanup,fireEvent,render,screen,within} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {AppShell} from "./AppShell";

vi.mock("next/navigation",()=>({useRouter:()=>({replace:vi.fn(),refresh:vi.fn(),back:vi.fn(),push:vi.fn()})}));
vi.mock("@/lib/auth/google",()=>({logout:vi.fn()}));

afterEach(()=>{cleanup();vi.restoreAllMocks();});

it("shows a retryable error when server logout fails instead of hiding the failure",async()=>{
  const {logout}=await import("@/lib/auth/google");
  vi.mocked(logout).mockRejectedValueOnce(new Error("unavailable"));
  render(<AppShell pathname="/" role="assessor" roles={["assessor"]}><h1>ホーム</h1></AppShell>);
  fireEvent.click(screen.getByTitle("ログアウト"));
  expect(await screen.findByRole("alert")).toHaveTextContent("ログアウトを完了できませんでした");
});

describe("system-admin navigation separation",()=>{
  it("shows only the management entry even when business roles are also assigned",()=>{
    render(<AppShell pathname="/admin/operations" role="system_admin" roles={["system_admin","manager","educator"]} displayName="システム管理者"><h1>システム運用</h1></AppShell>);
    expect(screen.getByRole("link",{name:"管理"})).toHaveAttribute("href","/admin/operations");
    expect(screen.queryByRole("link",{name:"訪問前チェック"})).not.toBeInTheDocument();
    expect(screen.queryByRole("link",{name:"振り返りチェックシート"})).not.toBeInTheDocument();
    expect(screen.queryByRole("link",{name:"現場の知識"})).not.toBeInTheDocument();
    expect(screen.getByRole("link",{name:"買取支援ツール ホーム"})).toHaveAttribute("href","/admin/operations");
  });
});

describe("business feature navigation",()=>{
  it("shows market price in the five-item mobile navigation and moves knowledge into More",()=>{
    const {container}=render(<AppShell pathname="/visits" role="manager" roles={["manager"]} displayName="管理者" featureFlags={{market_price_search:true}}><h1>訪問支援</h1></AppShell>);
    const navigation=container.querySelector<HTMLElement>('nav[aria-label="モバイルナビゲーション"]');
    expect(navigation).not.toBeNull();
    if(!navigation)return;
    expect(within(navigation).getAllByRole("link",{hidden:true})).toHaveLength(4);
    expect(within(navigation).getByRole("link",{name:"ホーム",hidden:true})).toHaveAttribute("href","/");
    expect(within(navigation).getByRole("link",{name:"訪問",hidden:true})).toHaveAttribute("href","/visits");
    expect(within(navigation).getByRole("link",{name:"買取相場",hidden:true})).toHaveAttribute("href","/market-price");
    expect(within(navigation).getByRole("link",{name:"振り返り",hidden:true})).toHaveAttribute("href","/reviews");
    fireEvent.click(within(navigation).getByRole("button",{name:"その他",hidden:true}));
    const dialog=container.querySelector<HTMLDialogElement>('dialog[aria-labelledby="mobile-more-title"]');
    expect(dialog).toHaveAttribute("open");
    if(!dialog)return;
    expect(within(dialog).getByRole("link",{name:/現場の知識/,hidden:true})).toHaveAttribute("href","/knowledge/talks");
    expect(within(dialog).getByRole("link",{name:/研修/,hidden:true})).toHaveAttribute("href","/training/roleplay");
    expect(within(dialog).getByRole("link",{name:/管理/,hidden:true})).toHaveAttribute("href","/admin/contents");
  });

  it("hides market price navigation when the feature flag is off",()=>{
    render(<AppShell pathname="/visits" role="assessor" roles={["assessor"]} featureFlags={{market_price_search:false}}><h1>訪問支援</h1></AppShell>);
    expect(screen.queryByRole("link",{name:"買取相場"})).not.toBeInTheDocument();
  });

  it("shows every knowledge feature by its concrete business name",()=>{
    render(<AppShell pathname="/knowledge/talks" role="assessor" roles={["assessor"]}><h1>切り返しトーク集</h1></AppShell>);
    expect(screen.getByRole("navigation",{name:"現場の知識の機能"})).toBeInTheDocument();
    expect(screen.getByRole("link",{name:"切り返しトーク集"})).toHaveAttribute("href","/knowledge/talks");
    expect(screen.getByRole("link",{name:"困ったときのフロー集"})).toHaveAttribute("href","/knowledge/flows");
    expect(screen.getByRole("link",{name:"用語集・金券買取価格表"})).toHaveAttribute("href","/knowledge/reference");
    expect(screen.getByRole("link",{name:"接客マニュアル・法務・コンプライアンス"})).toHaveAttribute("href","/knowledge/manuals");
  });

  it("shows AI roleplay and videos as training features",()=>{
    render(<AppShell pathname="/training/roleplay" role="assessor" roles={["assessor"]}><h1>AIロープレ</h1></AppShell>);
    expect(screen.getByRole("navigation",{name:"研修の機能"})).toBeInTheDocument();
    expect(screen.getByRole("link",{name:"AIロープレ"})).toHaveAttribute("href","/training/roleplay");
    expect(screen.getByRole("link",{name:"動画ライブラリ"})).toHaveAttribute("href","/training/videos");
  });

  it("keeps concrete knowledge and training links visible outside their sections",()=>{
    render(<AppShell pathname="/visits" role="assessor" roles={["assessor"]}><h1>訪問支援</h1></AppShell>);
    expect(screen.getByRole("link",{name:"困ったときのフロー集"})).toBeInTheDocument();
    expect(screen.getByRole("link",{name:"AIロープレ"})).toBeInTheDocument();
  });
});


describe("revision 07 navigation semantics",()=>{
  it("keeps management identity and current destination in the mobile menu",()=>{
    const {container}=render(<AppShell pathname="/performance" role="manager" roles={["manager"]} featureFlags={{purchase_performance:true,purchase_results:true}}><h1>実績</h1></AppShell>);
    expect(screen.getByRole("link",{name:"実績・ランキング"})).toHaveAttribute("aria-current","page");
    expect(screen.getByRole("link",{name:"実績・ランキング"})).toHaveAttribute("data-tone","management");
    const mobile=container.querySelector<HTMLElement>('nav[aria-label="モバイルナビゲーション"]')!;
    fireEvent.click(within(mobile).getByRole("button",{name:"その他",hidden:true}));
    const dialog=container.querySelector("dialog")!;
    expect(within(dialog).getByRole("link",{name:/実績・ランキング/,hidden:true})).toHaveAttribute("aria-current","page");
    expect(within(dialog).getByRole("link",{name:/^買取実績/,hidden:true})).toHaveAttribute("href","/purchase-results");
  });
  it("marks the mobile current page and system settings group",()=>{
    const {container}=render(<AppShell pathname="/admin/operations" role="system_admin" roles={["system_admin"]}><h1>運用</h1></AppShell>);
    expect(screen.getByRole("link",{name:"管理"})).toHaveAttribute("data-tone","master");
    const mobile=container.querySelector<HTMLElement>('nav[aria-label="モバイルナビゲーション"]')!;
    expect(within(mobile).getByRole("link",{name:"運用",hidden:true})).toHaveAttribute("aria-current","page");
  });
});
