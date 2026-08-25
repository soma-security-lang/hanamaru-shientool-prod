import {render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach,describe,expect,it,vi} from "vitest";

const mocks=vi.hoisted(()=>({
  redirect:vi.fn().mockResolvedValue(undefined),
  complete:vi.fn().mockResolvedValue(false),
  logout:vi.fn().mockResolvedValue(undefined),
  request:vi.fn().mockResolvedValue({roles:["manager"]}),
}));

vi.mock("@/lib/auth/google",()=>({
  beginGoogleLoginRedirect:mocks.redirect,
  completeGoogleLoginRedirect:mocks.complete,
  identityPlatformConfigured:()=>true,
  logout:mocks.logout,
}));
vi.mock("@/lib/api/client",()=>({apiClient:{request:mocks.request}}));

import {GoogleSignInButton} from "./GoogleSignInButton";

beforeEach(()=>vi.clearAllMocks());

describe("GoogleSignInButton",()=>{
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
