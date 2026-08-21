// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LaneAExperience } from "./Experience";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => { cleanup(); push.mockReset(); });

describe("LaneAExperience", () => {
  it("returns null for a screen owned by another lane", () => {
    const { container } = render(<LaneAExperience kind="transcript" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers a Google-only login interaction", async () => {
    const user = userEvent.setup();
    render(<LaneAExperience kind="auth" />);

    expect(screen.queryByLabelText("パスワード")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Googleでログイン" }));

    expect(screen.getByRole("status")).toHaveTextContent("ログインしました");
    expect(push).toHaveBeenCalledWith("/");
  });

  it("answers a selected home support question", async () => {
    const user = userEvent.setup();
    render(<LaneAExperience kind="dashboard" />);

    await user.click(screen.getByRole("button", { name: "録音同意を断られた場合は？" }));
    await user.click(screen.getByRole("button", { name: "質問する" }));

    expect(screen.getByRole("status")).toHaveTextContent("録音は行わず、訪問自体は継続できます");
  });

  it("filters the visit collection by canonical status", async () => {
    const user = userEvent.setup();
    render(<LaneAExperience kind="collection" />);

    await user.click(screen.getByRole("button", { name: "フィルター" }));
    await user.click(screen.getByRole("button", { name: "完了" }));

    expect(screen.getAllByText("訪問先D").length).toBeGreaterThan(0);
    expect(screen.queryByText("訪問先A")).not.toBeInTheDocument();
  });

  it("shows inline and summary validation for the visit form", async () => {
    const user = userEvent.setup();
    render(<LaneAExperience kind="form" />);

    const caseNumber = screen.getByLabelText(/案件番号/);
    await user.clear(caseNumber);
    await user.click(screen.getByRole("button", { name: /保存してPDFへ/ }));

    expect(screen.getByRole("alert")).toHaveTextContent("案件番号を入力してください");
    expect(caseNumber).toHaveAttribute("aria-invalid", "true");
  });

  it("edits and confirms a PDF extraction field with evidence preserved", async () => {
    const user = userEvent.setup();
    render(<LaneAExperience kind="document" />);

    const field = screen.getByLabelText("品物カテゴリ");
    await user.clear(field);
    await user.type(field, "腕時計");
    await user.click(screen.getByRole("button", { name: "この項目を確認" }));

    expect(field).toHaveValue("腕時計");
    expect(screen.getByRole("status")).toHaveTextContent("品物カテゴリを確認済みにしました");
    expect(screen.getAllByText("対象品：腕時計ほか（詳細は当日確認）").length).toBeGreaterThan(0);
  });

  it("requires consent before selecting and importing a Drive recording", async () => {
    const user = userEvent.setup();
    render(<LaneAExperience kind="recording" />);

    expect(screen.getByRole("button", { name: "Google Drive" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: /説明し、了承を得た/ }));
    await user.click(screen.getByRole("button", { name: "同意を記録" }));
    await user.click(screen.getByRole("button", { name: "Google Drive" }));
    await user.click(screen.getByRole("button", { name: "Driveを開く" }));
    await user.click(screen.getByRole("button", { name: "音声を取り込む" }));

    expect(screen.getByRole("status")).toHaveTextContent("Driveの音声を取り込みました");
  });

  it("moves a retry-wait job through running to succeeded", async () => {
    const user = userEvent.setup();
    render(<LaneAExperience kind="job" />);

    await user.click(screen.getByRole("button", { name: /今すぐ再試行/ }));
    expect(screen.getByRole("heading", { name: "処理中" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "状態を更新" }));

    expect(screen.getByRole("heading", { name: "完了" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /文字起こしを確認/ })).toBeEnabled();
  });
});
