import Fastify from 'fastify';
import {describe,it,expect} from 'vitest';
import {registerHelpRoutes} from './routes.js';
import {ApiProblem} from '../errors.js';
import type {BackendService} from '../service.js';
describe('help route input and authentication errors',()=>{
 async function make(authenticated=true){const app=Fastify({logger:false});app.decorateRequest('auth',null as never);app.addHook('onRequest',async request=>{if(!authenticated)throw new ApiProblem('AUTH_REQUIRED',401,'login required');request.auth={organizationId:'synthetic-org',membershipId:'synthetic-member',roles:['assessor']} as typeof request.auth;});registerHelpRoutes(app,{me:async()=>({featureFlags:{}})} as unknown as BackendService);await app.ready();return app;}
 it('preserves unauthenticated status before parsing the request',async()=>{const app=await make(false);try{const r=await app.inject({method:'POST',url:'/api/v1/help/questions',payload:{question:'操作を確認したい'}});expect(r.statusCode).toBe(401);}finally{await app.close();}});
 it('rejects oversized JSON as 413 and malformed JSON as 400 without echoing input',async()=>{const app=await make();try{const huge=await app.inject({method:'POST',url:'/api/v1/help/questions',payload:{question:'private-synthetic-marker'.repeat(2000)}});expect(huge.statusCode).toBe(413);expect(huge.body).not.toContain('private-synthetic-marker');const malformed=await app.inject({method:'POST',url:'/api/v1/help/questions',headers:{'content-type':'application/json'},payload:'{"question":'});expect(malformed.statusCode).toBe(400);}finally{await app.close();}});
});
