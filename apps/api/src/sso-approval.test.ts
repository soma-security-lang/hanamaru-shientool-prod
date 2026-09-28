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
  const system=vi.fn(async(_sql:string,_values?:unknown[])=>{
    void _sql; void _values;
    return {rows:[{user_id:user,organization_id:organization,approver:true}],rowCount:1};
  });
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

  it("does not prepare enrollment without the dedicated caller secret",async()=>{
    const response=await app.inject({method:"POST",url:"/internal/sso/enrollment",
      payload:{requestId:"33333333-3333-4333-8333-333333333333",productUserId:user,organizationId:organization}});
    expect(response.statusCode).toBe(403);
  });

  it("prepares only an active local membership and records a request-keyed event",async()=>{
    system.mockResolvedValueOnce({rows:[{user_id:user,organization_id:organization,approver:true}],rowCount:1});
    const requestId="33333333-3333-4333-8333-333333333333";
    const response=await app.inject({method:"POST",url:"/internal/sso/enrollment",
      headers:{"x-sso-approval-secret":secret},payload:{requestId,productUserId:user,organizationId:organization}});
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({state:"pending"});
    const [sql,parameters]=system.mock.calls.at(-1)!;
    expect(sql).toContain("INSERT INTO sso_enrollment_events");
    expect(parameters).toEqual([user,organization,requestId]);
  });
});
