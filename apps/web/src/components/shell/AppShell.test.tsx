import {cleanup,render,screen} from "@testing-library/react";
import {afterEach,describe,expect,it,vi} from "vitest";
import {AppShell} from "./AppShell";

vi.mock("next/navigation",()=>({useRouter:()=>({replace:vi.fn(),refresh:vi.fn()})}));

afterEach(()=>{cleanup();vi.restoreAllMocks();});

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
