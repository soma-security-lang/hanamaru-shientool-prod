import {render,screen,waitFor} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {beforeEach,describe,expect,it,vi} from "vitest";

const mocks=vi.hoisted(()=>({
  login:vi.fn().mockResolvedValue(undefined),
  credentialLogin:vi.fn().mockResolvedValue(undefined),
  complete:vi.fn().mockResolvedValue(false),
  logout:vi.fn().mockResolvedValue(undefined),
  request:vi.fn().mockResolvedValue({roles:["manager"]}),
  gisInitialize:vi.fn(),
  gisRenderButton:vi.fn(),
}));

vi.mock("@/lib/auth/google",()=>({
  completeGoogleLoginRedirect:mocks.complete,
  identityPlatformConfigured:()=>true,
  loginWithGoogleCredential:mocks.credentialLogin,
  loginWithGooglePopup:mocks.login,
  logout:mocks.logout,
}));
vi.mock("@/lib/api/client",()=>({apiClient:{request:mocks.request}}));

import {GoogleSignInButton} from "./GoogleSignInButton";

beforeEach(()=>vi.clearAllMocks());

describe("GoogleSignInButton",()=>{
  it("completes popup authentication and verifies membership before navigation",async()=>{
    const user=userEvent.setup();
    const onSuccess=vi.fn();
    render(<GoogleSignInButton onSuccess={onSuccess} onError={vi.fn()}/>);
    await waitFor(()=>expect(mocks.complete).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button",{name:"Googleでログイン"}));
    expect(mocks.login).toHaveBeenCalledTimes(1);
    expect(mocks.request).toHaveBeenCalledWith("/me");
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("verifies membership after returning from Identity Platform",async()=>{
    mocks.complete.mockResolvedValueOnce(true);
    const onSuccess=vi.fn();
    render(<GoogleSignInButton onSuccess={onSuccess} onError={vi.fn()}/>);
    await waitFor(()=>expect(mocks.request).toHaveBeenCalledWith("/me"));
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it("uses the FedCM-capable Google credential button without Firebase popup state",async()=>{
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID="123456789012-client.apps.googleusercontent.com";
    (window as unknown as {google:unknown}).google={accounts:{id:{initialize:mocks.gisInitialize,renderButton:mocks.gisRenderButton}}};
    const onSuccess=vi.fn();
    render(<GoogleSignInButton onSuccess={onSuccess} onError={vi.fn()}/>);
    await waitFor(()=>expect(mocks.gisInitialize).toHaveBeenCalledTimes(1));
    const config=mocks.gisInitialize.mock.calls[0]?.[0] as {use_fedcm_for_button:boolean;callback:(response:{credential:string})=>void};
    expect(config.use_fedcm_for_button).toBe(true);
    config.callback({credential:"google-id-token"});
    await waitFor(()=>expect(mocks.credentialLogin).toHaveBeenCalledWith("google-id-token"));
    expect(mocks.request).toHaveBeenCalledWith("/me");
    expect(onSuccess).toHaveBeenCalledTimes(1);
    delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    delete (window as unknown as {google?:unknown}).google;
  });
});
