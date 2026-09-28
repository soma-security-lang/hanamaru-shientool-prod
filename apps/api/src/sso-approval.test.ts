import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import {createLocalProviders} from "@hanamaru/platform";
import {buildApp} from "./app.js";
import {loadConfig} from "./config.js";
import type {FastifyInstance} from "fastify";

const user="11111111-1111-4111-8111-111111111111";
const organization="22222222-2222-4222-8222-222222222222";
const secret="synthetic-hanamaru-approval-secret-32-characters";

describe("internal SSO approval read-back",()=>{
  let app:FastifyInstance;
  const system=vi.fn(async()=>({rows:[{user_id:user,organization_id:organization,approver:true}],rowCount:1}));
  beforeAll(async()=>{
    app=await buildApp({repository:{system,close:async()=>{}} as never,
      providers:createLocalProviders(),config:loadConfig({NODE_ENV:"test",SSO_APPROVAL_SECRET:secret})});
  });
  afterAll(async()=>{await app.close();});

  it("rejects callers without the dedicated secret before querying",async()=>{
    const response=await app.inject({method:"POST",url:"/internal/sso/eligibility",
      payload:{productUserId:user,organizationId:organization,purpose:"approver"}});
    expect(response.statusCode).toBe(403);
    expect(system).not.toHaveBeenCalled();
  });

  it("returns only current same-organization manager eligibility",async()=>{
    const response=await app.inject({method:"POST",url:"/internal/sso/eligibility",
      headers:{"x-sso-approval-secret":secret},
      payload:{productUserId:user,organizationId:organization,purpose:"approver"}});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({productUserId:user,organizationId:organization,active:true,approver:true});
    expect(response.headers["cache-control"]).toContain("no-store");
  });

  it("fails closed for a missing or inactive membership",async()=>{
    system.mockResolvedValueOnce({rows:[],rowCount:0});
    const response=await app.inject({method:"POST",url:"/internal/sso/eligibility",
      headers:{"x-sso-approval-secret":secret},
      payload:{productUserId:user,organizationId:organization,purpose:"target"}});
    expect(response.json()).toMatchObject({active:false,approver:false});
  });
});
