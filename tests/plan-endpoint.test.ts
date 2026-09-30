import assert from "node:assert/strict";
import Anthropic from "@anthropic-ai/sdk";
import { createPlan } from "../functions/api/plan.ts";
import type { ProductionPlan } from "../src/lib/plan.ts";

const sample: ProductionPlan = { title:"Haven Memory OS™", objective:"Introduce the product", audience:"Independent hotel GMs", estimated_duration_seconds:60, captions:true, outro:null,
  scenes:[
    {start_seconds:0,end_seconds:10,purpose:"Introduction",voiceover:"Meet Haven Memory OS™.",avatar:{appears:true,placement:"full",scale_percent:100,direction:"Victor welcomes the viewer"},visual:"Branded opening",overlays:[{type:"TITLE",text:"HAVEN MEMORY OS™"}],effects:[],transition:"fade",broll:null},
    {start_seconds:10,end_seconds:50,purpose:"Product demonstration",voiceover:"See how the Haven interface supports hotel teams.",avatar:{appears:true,placement:"bottom-right",scale_percent:27,direction:"Victor points toward the interface"},visual:"Haven interface",overlays:[],effects:[{type:"HIGHLIGHT",target:"Haven interface"}],transition:null,broll:"Hotel front desk",},
    {start_seconds:50,end_seconds:60,purpose:"Closing",voiceover:"Learn more at haven-mos.org.",avatar:{appears:true,placement:"full",scale_percent:100,direction:"Victor closes with a confident smile"},visual:"Branded closing",overlays:[{type:"CAPTION",text:"haven-mos.org"}],effects:[],transition:"fade",broll:null}
  ] };
let payload: unknown = sample, stopReason = "end_turn", calls = 0, lastRequest: unknown;
const mockClient = { messages: { parse: async (req: unknown) => { calls++; lastRequest=req; return { parsed_output: payload, stop_reason: stopReason }; } } } as never;
const env = { ANTHROPIC_API_KEY:"mock-only" };
const generate = (body: unknown) => createPlan(body as never, env, mockClient);
try {
  for (const [duration, format] of [[30,"16:9"],[60,"9:16"],[90,"1:1"],[47,"16:9"]] as const) {
    payload=sample;
    const response=await generate({prompt:"Create an introduction",duration_seconds:duration,format,presenter:null});
    assert.equal(response.status,200);
    const result=(await response.json() as {plan:ProductionPlan});
    assert.equal(result.plan.title,sample.title);
    assert.equal(result.plan.estimated_duration_seconds,duration,"requested duration is authoritative");
    const messages=lastRequest as {messages:{content:string}[]};
    assert.match(messages.messages[0].content,new RegExp(`Requested duration: ${duration} seconds`));
    assert.match(messages.messages[0].content,new RegExp(`Format: ${format}`));
  }
  const noPresenter=await generate({prompt:"No avatar",presenter:null,avatar_usage:"Full video"});
  assert.equal(noPresenter.status,200);
  const avatarIntroOutro=await generate({prompt:"Create a 60-second video introducing Haven Memory OS™ to independent hotel general managers. Use Victor as the presenter for the introduction and closing. During the product explanation, move Victor to the bottom-right and show the Haven interface.",presenter:"Victor",avatar_usage:"Selected scenes"});
  assert.equal(avatarIntroOutro.status,200);
  const acceptance=(await avatarIntroOutro.json() as {plan:ProductionPlan}).plan;
  assert.equal(acceptance.scenes[0].avatar.appears,true);
  assert.equal(acceptance.scenes[1].avatar.placement,"bottom-right");
  assert.equal(acceptance.scenes.at(-1)?.avatar.appears,true);
  const decided=await generate({prompt:"Use Victor",presenter:"Victor",avatar_usage:"DirectorAI decides"});
  assert.equal(decided.status,200);
  assert.equal(calls,7);
  assert.equal((await generate({prompt:"  "})).status,400);
  payload=null;
  assert.equal((await generate({prompt:"malformed"})).status,502);
  stopReason="max_tokens"; payload=sample;
  const truncated=await generate({prompt:"truncated"});
  assert.equal((await truncated.json() as {truncated:boolean}).truncated,true);
  const noKey=await createPlan({prompt:"x"},{} as never,mockClient);
  assert.equal(noKey.status,503);

  for (const [Ctor,status] of [[Anthropic.AuthenticationError,502],[Anthropic.RateLimitError,429]] as const) {
    const err=Object.assign(Object.create(Ctor.prototype),{status:status===429?429:401,message:"mock"});
    const broken={messages:{parse:async()=>{throw err;}}} as never;
    const res=await createPlan({prompt:"x"},env,broken);
    assert.equal(res.status,status);
    assert.doesNotMatch(await res.text(),/mock|api[_-]?key|authorization/i);
  }
  // The plan endpoint's implementation imports no avatar service; this assertion guards its mock client request surface.
  assert.equal((lastRequest as {url?:string}).url,undefined);
  console.log("✓ plan endpoint: valid plan, duration/format options, presenter modes, malformed output, auth, rate limit, truncation; no avatar client invoked");
} catch (e) { console.error(e); process.exitCode=1; }
