import {render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach,describe,expect,it,vi} from "vitest";

const mocks=vi.hoisted(()=>({
  redirect:vi.fn().mockResolvedValue(undefined),
  popup:vi.fn().mockResolvedValue(undefined),
  usePopup:vi.fn().mockReturnValue(false),
  complete:vi.fn().mockResolvedValue(false),
  logout:vi.fn().mockResolvedValue(undefined),
  request:vi.fn().mockResolvedValue({roles:["manager"]}),
}));

vi.mock("@/lib/auth/google",()=>({
  beginGoogleLoginRedirect:mocks.redirect,
  loginWithGooglePopup:mocks.popup,
  googleLoginUsesPopup:mocks.usePopup,
  completeGoogleLoginRedirect:mocks.complete,
  identityPlatformConfigured:()=>true,
  logout:mocks.logout,
}));
vi.mock("@/lib/api/client",()=>({apiClient:{request:mocks.request}}));

import {GoogleSignInButton} from "./GoogleSignInButton";

beforeEach(()=>{vi.clearAllMocks();mocks.usePopup.mockReturnValue(false);});

describe("GoogleSignInButton",()=>{
  it("uses supported popup on a different auth domain and verifies existing membership",async()=>{
    mocks.usePopup.mockReturnValue(true);
    const onSuccess=vi.fn(),user=userEvent.setup();
    render(<GoogleSignInButton onSuccess={onSuccess} onError={vi.fn()}/>);
    await user.click(screen.getByRole("button",{name:"Googleでログイン"}));
    await waitFor(()=>expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(mocks.popup).toHaveBeenCalledTimes(1);expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.request).toHaveBeenCalledWith("/me");
  });
  it("does not grant access when popup identity has no product membership",async()=>{
    mocks.usePopup.mockReturnValue(true);mocks.request.mockRejectedValueOnce(new Error("forbidden"));
    const onSuccess=vi.fn(),onError=vi.fn(),user=userEvent.setup();
    render(<GoogleSignInButton onSuccess={onSuccess} onError={onError}/>);
    await user.click(screen.getByRole("button",{name:"Googleでログイン"}));
    await waitFor(()=>expect(mocks.logout).toHaveBeenCalledTimes(1));
    expect(onSuccess).not.toHaveBeenCalled();expect(onError).toHaveBeenCalledWith("このGoogleアカウントではログインできません。管理者へ利用登録を依頼してください。");
  });
  it("recovers from a blocked or cancelled popup without switching authentication methods",async()=>{
    mocks.usePopup.mockReturnValue(true);mocks.popup.mockRejectedValueOnce(new Error("popup blocked"));
    const onError=vi.fn(),user=userEvent.setup();
    render(<GoogleSignInButton onSuccess={vi.fn()} onError={onError}/>);
    await user.click(screen.getByRole("button",{name:"Googleでログイン"}));
    await waitFor(()=>expect(onError).toHaveBeenCalledWith("Googleログインを開始できませんでした。もう一度お試しください。"));
    expect(mocks.redirect).not.toHaveBeenCalled();expect(mocks.request).not.toHaveBeenCalled();
    expect(screen.getByRole("button",{name:"Googleでログイン"})).toBeEnabled();
  });
  it("starts same-tab Identity Platform redirect authentication",async()=>{
    const user=userEvent.setup();
    render(<GoogleSignInButton onSuccess={vi.fn()} onError={vi.fn()}/>);
    await waitFor(()=>expect(mocks.complete).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button",{name:"Googleでログイン"}));
    expect(mocks.redirect).toHaveBeenCalledTimes(1);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it("verifies membership after returning from Identity Platform",async()=>{
    mocks.complete.mockResolvedValueOnce(true);
    const onSuccess=vi.fn();
    render(<GoogleSignInButton onSuccess={onSuccess} onError={vi.fn()}/>);
    await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith("/me"));
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("shows a recoverable error when redirect cannot start",async()=>{
    mocks.redirect.mockRejectedValueOnce(new Error("redirect failed"));
    const user=userEvent.setup();
    const onError=vi.fn();
    render(<GoogleSignInButton onSuccess={vi.fn()} onError={onError}/>);
    await user.click(screen.getByRole("button",{name:"Googleでログイン"}));
    await waitFor(()=>expect(onError).toHaveBeenCalledWith("Googleログインを開始できませんでした。もう一度お試しください。"));
    expect(screen.getByRole("button",{name:"Googleでログイン"})).toBeEnabled();
  });
});
