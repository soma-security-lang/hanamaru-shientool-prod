// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { LaneBExperience } from "./Experience";

afterEach(cleanup);

describe("LaneBExperience", () => {
  it("returns null for a screen outside lane B", () => {
    const { container } = render(<LaneBExperience kind="auth" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("edits transcript segments, applies pasted lines, and exposes conflicts", async () => {
    const user = userEvent.setup();
    render(<LaneBExperience kind="transcript" />);

    await user.click(screen.getByRole("button", { name: "テキスト貼付補助" }));
    await user.type(screen.getByLabelText("貼り付けるテキスト"), "貼付した一行目\n貼付した二行目");
    await user.click(screen.getByRole("button", { name: "発話区間へ反映" }));

    const segmentEditors = screen.getAllByLabelText("発話内容");
    expect(segmentEditors[0]).toHaveValue("貼付した一行目");
    expect(segmentEditors[1]).toHaveValue("貼付した二行目");

    await user.click(screen.getByRole("button", { name: "競合を再現" }));
    expect(screen.getByRole("alert")).toHaveTextContent("別の修正があります");
    await user.click(screen.getByRole("button", { name: "最新内容と比較" }));
    expect(screen.getByText("最新の保存版")).toBeInTheDocument();
  });

  it("moves from review findings to their evidence and regenerates without replacing the current view", async () => {
    const user = userEvent.setup();
    render(<LaneBExperience kind="review" />);

    await user.click(screen.getByRole("button", { name: /確認質問を一つずつ区切る/ }));
    expect(screen.getByRole("complementary", { name: /確認質問を一つずつ区切る/ })).toHaveTextContent("確認したい点が二つあります");

    await user.click(screen.getByRole("button", { name: /振り返りを再生成/ }));
    expect(screen.getByText("生成版 2")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("既存の版は保持されています");
  });

  it("traps sheet focus, closes with Escape, and restores the trigger", async () => {
    const user = userEvent.setup();
    render(<LaneBExperience kind="history" />);

    await user.selectOptions(screen.getByLabelText("状態"), "完了");
    expect(screen.getByRole("status")).toHaveTextContent("1件を表示");
    const trigger = screen.getByRole("button", { name: /内容を開く/ });
    await user.click(trigger);
    expect(screen.getByRole("dialog")).toHaveTextContent("訪問案件 DEMO-010");
    const close = screen.getByRole("button", { name: "詳細を閉じる" });
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(screen.getByRole("link", { name: /振り返りを開く/ })).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("does not commit a Japanese knowledge query while IME composition is active", () => {
    render(<LaneBExperience kind="knowledge" />);
    const input = screen.getByLabelText("現場の知識を検索");

    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "クーリングオフ" } });
    expect(screen.getByRole("status")).toHaveTextContent("4件");

    fireEvent.compositionEnd(input, { data: "クーリングオフ" });
    expect(screen.getByRole("status")).toHaveTextContent("1件");
    expect(screen.getAllByText("クーリングオフの説明")).toHaveLength(2);
  });

  it("switches from glossary to voucher prices and keeps source evidence available", async () => {
    const user = userEvent.setup();
    render(<LaneBExperience kind="reference" />);

    expect(screen.getByRole("tabpanel", { name: "用語" })).toHaveTextContent("比重");
    await user.click(screen.getByRole("tab", { name: "金券価格" }));
    expect(screen.getByRole("table", { name: /金券価格表/ })).toHaveTextContent("額面の90%");
    await user.click(screen.getAllByRole("button", { name: /根拠/ })[0]);
    expect(screen.getByRole("status")).toHaveTextContent("価格表・承認版 2026.08");
  });

  it("supports roleplay feedback, video controls, and self-only history without rankings", async () => {
    const user = userEvent.setup();
    render(<LaneBExperience kind="training" />);

    await user.click(screen.getByRole("radio", { name: /承知しました。金額と根拠だけ/ }));
    expect(screen.getByRole("status")).toHaveTextContent("良い組み立てです");

    await user.click(screen.getByRole("tab", { name: "動画" }));
    await user.click(screen.getByRole("button", { name: "動画を再生" }));
    expect(screen.getByRole("button", { name: "動画を一時停止" })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "履歴" }));
    expect(screen.getByRole("tabpanel", { name: "自分の研修履歴" })).toHaveTextContent("次に試すこと");
    expect(screen.queryByText(/1位|ランキング|個人点数/)).not.toBeInTheDocument();
  });
});
