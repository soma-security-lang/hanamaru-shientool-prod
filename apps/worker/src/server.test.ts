import {describe,expect,it} from "vitest";
import {taskDeliveryHttpStatus} from "./server.js";

describe("Cloud Tasks delivery response",()=>{
  it("acknowledges durable retry and terminal states",()=>{
    expect(taskDeliveryHttpStatus("retry_wait","retry_wait")).toBe(200);
    expect(taskDeliveryHttpStatus("not_claimed","retry_wait")).toBe(200);
    expect(taskDeliveryHttpStatus("not_claimed","succeeded")).toBe(200);
    expect(taskDeliveryHttpStatus("not_claimed","cancelled")).toBe(200);
  });
  it("asks Cloud Tasks to retry only while the current attempt is running",()=>{
    expect(taskDeliveryHttpStatus("not_claimed","running")).toBe(503);
  });
});
