// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { LaneCExperience } from "./Experience";

afterEach(cleanup);

describe("LaneCExperience", () => {
  it("対象外の画面種別では何も描画しない", () => {
    const { container } = render(<LaneCExperience kind="dashboard" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("利用者を匿名fixtureで招待し、権限変更の影響を確認する", async () => {
    const user = userEvent.setup();
    render(<LaneCExperience kind="users" />);

    await user.click(screen.getByRole("button", { name: "利用者を招待" }));
    await user.click(screen.getByRole("button", { name: "招待を確認" }));
    expect(screen.getByRole("status")).toHaveTextContent("招待を送信しました");

    await user.selectOptions(screen.getByLabelText("権限"), "educator");
    await user.click(screen.getByRole("button", { name: "影響を確認して変更" }));
    const dialog = screen.getByRole("dialog", { name: "権限変更の影響を確認" });
    expect(dialog).toHaveTextContent("担当中ジョブは1件");
    await user.click(within(dialog).getByRole("button", { name: "権限を変更" }));
    expect(screen.getByRole("status")).toHaveTextContent("educatorへ変更");

    await user.click(screen.getByRole("button", { name: "セッション失効" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "セッションを失効" }));
    expect(screen.getByText("有効セッション").nextElementSibling).toHaveTextContent("0件");
  });

  it("確認dialogのfocusを閉じ込め、Escape後に起点へ戻す", async () => {
    const user = userEvent.setup();
    render(<LaneCExperience kind="users" />);
    await user.selectOptions(screen.getByLabelText("権限"), "educator");
    const trigger = screen.getByRole("button", { name: "影響を確認して変更" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "権限変更の影響を確認" });
    const cancel = within(dialog).getByRole("button", { name: "キャンセル" });
    const confirm = within(dialog).getByRole("button", { name: "権限を変更" });
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(confirm).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.keyboard("{Escape}");
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(trigger).toHaveFocus();
  });

  it("ジョブを検索し、試行履歴を見て再試行と取消を行う", async () => {
    const user = userEvent.setup();
    render(<LaneCExperience kind="jobs" />);

    await user.type(screen.getByLabelText("ジョブ・request IDを検索"), "41c0");
    expect(screen.getByRole("button", { name: /PDF抽出/ })).toBeVisible();
    expect(screen.getByRole("heading", { name: "試行履歴" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "再試行" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "再試行を受付" }));
    expect(screen.getByRole("status")).toHaveTextContent("再試行しました");
    expect(screen.getByText("Attempt 3")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "取消" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "取消を受付" }));
    expect(screen.getByRole("status")).toHaveTextContent("取消を受け付けました");
  });

  it("8種のコンテンツを切り替え、編集内容をpreviewして新しい版を保存する", async () => {
    const user = userEvent.setup();
    render(<LaneCExperience kind="contents" />);

    expect(screen.getAllByRole("tab")).toHaveLength(8);
    await user.click(screen.getByRole("tab", { name: /法令・注意/ }));
    const title = screen.getByLabelText("タイトル");
    await user.clear(title);
    await user.type(title, "法令説明の匿名デモ版");
    expect(screen.getByRole("heading", { name: "法令説明の匿名デモ版" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "下書きを保存" }));
    expect(screen.getByRole("status")).toHaveTextContent("新しい下書き版");
    expect(screen.getByText("v4", { selector: "strong" })).toBeVisible();
  });

  it("Legal Holdを適用し、削除には確認phraseを要求する", async () => {
    const user = userEvent.setup();
    render(<LaneCExperience kind="retention" />);

    await user.click(screen.getByRole("button", { name: /DEMO-028/ }));
    await user.click(screen.getByRole("button", { name: "削除を開始" }));
    let dialog = screen.getByRole("dialog", { name: "削除開始の最終確認" });
    const confirmDelete = within(dialog).getByRole("button", { name: "削除を開始" });
    expect(confirmDelete).toBeDisabled();
    await user.type(within(dialog).getByLabelText(/確認のため/), "削除を開始");
    await user.click(confirmDelete);
    expect(screen.getByRole("status")).toHaveTextContent("完了確認前は成功扱いにしません");

    await user.click(screen.getByRole("button", { name: "Legal Holdを設定" }));
    dialog = screen.getByRole("dialog", { name: "Legal Holdを設定" });
    await user.click(within(dialog).getByRole("button", { name: "Holdを設定" }));
    expect(screen.getByRole("button", { name: "削除を開始" })).toBeDisabled();
    expect(screen.getByText("設定中・削除停止")).toBeVisible();
  });

  it("監査イベントをrequest IDで検索してcopy結果を知らせる", async () => {
    const user = userEvent.setup();
    render(<LaneCExperience kind="audit" />);

    await user.type(screen.getByLabelText("action・result・request IDを検索"), "req-demo-018-c");
    expect(screen.getByText("13:54・role.assign")).toBeVisible();
    await user.click(screen.getByRole("button", { name: /13:54・role.assign/ }));
    await user.click(screen.getByRole("button", { name: "request IDをコピー" }));
    expect(screen.getByRole("status")).toHaveTextContent("req-demo-018-cをコピー");
    expect(screen.getByText("req-demo-018-c", { selector: "code" })).toBeVisible();
  });

  it("承認基準を満たしたexact versionを承認し、理由付きで差し戻せる", async () => {
    const user = userEvent.setup();
    render(<LaneCExperience kind="approval" />);

    const approve = screen.getByRole("button", { name: "この版を承認" });
    expect(approve).toBeDisabled();
    for (const checkbox of screen.getAllByRole("checkbox")) await user.click(checkbox);
    expect(approve).toBeEnabled();
    await user.click(approve);
    await user.click(within(screen.getByRole("dialog", { name: "v4を承認" })).getByRole("button", { name: "承認を記録" }));
    expect(screen.getByRole("status")).toHaveTextContent("自動公開はしていません");

    await user.type(screen.getByLabelText("判断コメント"), "法令表現を再確認してください。");
    await user.click(screen.getByRole("button", { name: "差し戻す" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("差し戻しました"));
  });

  it("集約chartと同値のtableを提供し、個人列を持たない", async () => {
    const user = userEvent.setup();
    render(<LaneCExperience kind="analytics" />);

    const table = screen.getByRole("table", { name: "グラフと同じ集約値" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).queryByRole("columnheader", { name: /利用者|氏名|順位|人事/ })).not.toBeInTheDocument();
    expect(screen.getByText("母数38件・個人別表示なし")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "表を閉じる" }));
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "表で確認" }));
    expect(screen.getByRole("table", { name: "グラフと同じ集約値" })).toBeVisible();
  });
});
