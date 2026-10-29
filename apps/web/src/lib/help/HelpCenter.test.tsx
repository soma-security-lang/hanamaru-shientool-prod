import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import HelpCenter, { HelpMarkdown } from "./HelpCenter";
import type { HelpArticle, HelpAnswer } from "./engine";
afterEach(cleanup);
const article: HelpArticle = {
  slug: "request",
  title: "備品の発注依頼",
  category: "操作手順",
  audience: "現場",
  updated: "2026-10-29",
  roles: [],
  features: [],
  screens: [{ href: "/requests", label: "発注依頼" }],
  keywords: ["備品"],
  body: "## 操作手順\n1. 数量を入力します。\n2. 確認します。\n",
  sections: [
    { id: "section-0", title: "操作手順", text: "1. 数量を入力します。" },
  ],
};
const answer: HelpAnswer = {
  kind: "answer",
  message: "手順をご案内します。",
  sections: article.sections,
  sources: [{ href: "/help/request", label: article.title }],
  screens: article.screens,
};
const props = {
  name: "備品管理",
  articles: [article],
  examples: ["備品を依頼したい"],
};
describe("HelpCenter", () => {
  it("provides normal search and category navigation independently of AI", () => {
    render(<HelpCenter {...props} ask={vi.fn()} />);
    expect(screen.getByRole("link", { name: /備品の発注依頼/ })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("キーワード"), {
      target: { value: "存在しないキーワード" },
    });
    expect(screen.getByText(/一致する記事がありません/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText("キーワード"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("カテゴリ"), {
      target: { value: "用語" },
    });
    expect(screen.queryByRole("link", { name: /備品の発注依頼/ })).toBeNull();
  });
  it("answers with sources and screen links, then includes follow-up history", async () => {
    const ask = vi.fn().mockResolvedValue(answer);
    render(<HelpCenter {...props} ask={ask} />);
    fireEvent.click(screen.getByRole("button", { name: "備品を依頼したい" }));
    fireEvent.click(
      screen.getByRole("button", { name: "質問する" }),
    );
    await screen.findByText("手順をご案内します。");
    expect(
      screen.getByRole("link", { name: "発注依頼を開く" }).getAttribute("href"),
    ).toBe("/requests");
    expect(
      screen.getAllByRole("link", { name: article.title }).length,
    ).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText("質問", { exact: true }), {
      target: { value: "修正するには？" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "質問する" }),
    );
    await waitFor(() => expect(ask).toHaveBeenCalledTimes(2));
    expect(ask.mock.calls[1]?.[0].history[0]?.sourceSlugs).toEqual(["request"]);
    fireEvent.click(screen.getByRole("button", { name: "会話をクリア" }));
    expect(screen.queryByText("手順をご案内します。")).toBeNull();
  });
  it("handles network failure without removing article search", async () => {
    render(
      <HelpCenter
        {...props}
        ask={async () => {
          throw Error("fail");
        }}
      />,
    );
    fireEvent.change(screen.getByLabelText("質問", { exact: true }), {
      target: { value: "備品" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "質問する" }),
    );
    await screen.findByRole("alert");
    expect(screen.getByLabelText("キーワード")).toBeTruthy();
  });
  it("renders article headings, lists and accessible table headers", () => {
    render(<HelpCenter {...props} slug="request" ask={vi.fn()} />);
    expect(screen.getByRole("navigation", { name: "記事の目次" })).toBeTruthy();
    expect(screen.getByText("数量を入力します。")).toBeTruthy();
  });
  it("never interprets raw HTML, script URLs or external images as executable markup", () => {
    const { container } = render(
      <HelpMarkdown
        body={
          "<script>alert(1)</script>\n[危険](javascript:alert)\n![画像](https://evil.invalid/x.png)\n| 見出し | 値 |\n|---|---|\n| A | B |"
        }
      />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("columnheader", { name: "見出し" })).toBeTruthy();
  });
});
