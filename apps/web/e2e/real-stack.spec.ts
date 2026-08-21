import {expect,test} from "@playwright/test";
import {PDFDocument,StandardFonts} from "pdf-lib";
import {createLiveSession,installLiveSession,type LiveSession} from "./auth";

const managerToken=process.env.LIVE_E2E_GOOGLE_ID_TOKEN??process.env.LIVE_E2E_IDENTITY_PLATFORM_ID_TOKEN;
test.skip(process.env.REAL_STACK_E2E!=="1"||!managerToken,"live stack and an approved manager identity token are required");
let session:LiveSession;let visitId=process.env.LIVE_E2E_EXISTING_VISIT_ID??"";
test.beforeAll(async()=>{session=await createLiveSession(managerToken!);expect(session.me.roles).toContain("manager");});
test.afterAll(async()=>{await session?.api.dispose();});
test.beforeEach(async({context})=>{await installLiveSession(context,session);});

async function visitPdf(){
  const document=await PDFDocument.create();const font=await document.embedFont(StandardFonts.Helvetica);const page=document.addPage([595,842]);
  page.drawText("Visit information",{x:56,y:780,size:18,font});
  page.drawText("visitDate: 2026-08-20",{x:56,y:735,size:12,font});
  page.drawText("customerLabel: LocalE2ECustomer",{x:56,y:710,size:12,font});
  page.drawText("appraisalItems: Anonymous watch and camera",{x:56,y:685,size:12,font});
  return Buffer.from(await document.save());
}

test.describe.serial("live browser workflow",()=>{
test("PDF import and preparation cross API, storage, workers, AI and PostgreSQL",async({page})=>{
  test.skip(Boolean(process.env.LIVE_E2E_EXISTING_VISIT_ID),"using an existing visit to resume a provider workflow");
  test.setTimeout(180_000);
  await page.goto("/visits");
  await page.getByRole("link",{name:"PDFから訪問を登録"}).click();
  await page.locator('input[type="file"]').setInputFiles({name:"visit-information.pdf",mimeType:"application/pdf",buffer:await visitPdf()});
  await expect(page).toHaveURL(/\/visits\/[0-9a-f-]{36}\/import$/,{timeout:30_000});
  visitId=page.url().match(/\/visits\/([0-9a-f-]{36})\/import/)?.[1]??"";expect(visitId).not.toBe("");
  await expect(page.getByRole("textbox",{name:"訪問予定日"})).toHaveValue("2026-08-20",{timeout:120_000});
  const customer=page.getByRole("textbox",{name:"お客様表示名"});
  await expect(customer).toHaveValue("LocalE2ECustomer");
  await expect(page.getByRole("textbox",{name:"査定品"})).toHaveValue("Anonymous watch and camera");
  await customer.fill("LocalE2EConfirmed");
  await page.getByRole("button",{name:"内容を確定して訪問前チェックへ"}).click();
  await expect(page).toHaveURL(/\/visits\/[0-9a-f-]{36}\/preparation$/);
  await expect(page.getByRole("heading",{name:"訪問前チェック",exact:true})).toBeVisible();
  await expect(page.getByRole("checkbox")).toHaveCount(4,{timeout:120_000});
  for(const checkbox of await page.getByRole("checkbox").all())await checkbox.check();
  await page.getByRole("button",{name:"確認して準備を完了"}).click();
  await expect(page.getByRole("button",{name:"準備完了"})).toBeVisible();
});

test("audio upload, STT, speaker confirmation and AI review complete through live providers",async({page})=>{
  const audioPath=process.env.LIVE_E2E_AUDIO_PATH;test.skip(!audioPath,"LIVE_E2E_AUDIO_PATH is required for live Speech-to-Text");expect(visitId).not.toBe("");test.setTimeout(300_000);
  await page.goto(`/visits/${visitId}/transcription`);
  await page.getByRole("checkbox",{name:/録音同意/}).check();
  await page.locator('input[type="file"]').setInputFiles(audioPath!);
  await expect.poll(()=>page.locator("textarea[aria-label^='発話']").count(),{timeout:180_000}).toBeGreaterThan(0);
  await expect(page.getByText(/人物を識別する番号ではなく/)).toBeVisible();
  const continueWithRisk=page.getByRole("button",{name:"内容を確認して利用継続"});if(await continueWithRisk.count())await continueWithRisk.click();
  const speakerSelects=page.locator("select[aria-label$='の役割']");
  for(let index=0;index<await speakerSelects.count();index++)await speakerSelects.nth(index).selectOption(index%2===0?"staff":"customer");
  await page.getByRole("button",{name:"文字起こしを確定"}).click();
  await expect(page.getByRole("button",{name:"確定しました"})).toBeVisible();
  await page.goto(`/visits/${visitId}/review/input`);await expect(page.getByRole("button",{name:/AI振り返りを作成/})).toBeEnabled();await page.getByRole("button",{name:/AI振り返りを作成/}).click();
  await expect(page).toHaveURL(new RegExp(`/visits/${visitId}/review$`));
  await expect.poll(()=>page.locator("button[aria-pressed]").count(),{timeout:180_000}).toBeGreaterThanOrEqual(6);
  await page.getByRole("button",{name:"確認を完了"}).click();await expect(page.getByRole("button",{name:"確認済み"})).toBeVisible();
});
});
