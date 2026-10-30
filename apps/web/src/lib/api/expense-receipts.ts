import {apiClient} from "./client";
export interface ReceiptReviewFields {paidOn:string|null;merchant:string|null;amount:number|null;currency:string|null;category:string|null;paymentSource:string|null;note:string|null}
type ReadingField={value:string|null;evidence:string|null};
export interface ReceiptDto {
  id:string;batchId:string;status:string;lockVersion:number;expiresAt:string;registeredItemId:string|null;failureClass:string|null;
  readingJson:null|{model:string;documentKind:string;paidOn:ReadingField;merchant:ReadingField;paidTotal:ReadingField;currency:ReadingField;purposeHint:ReadingField;warnings:string[]};
  reviewJson:ReceiptReviewFields|null;
}
export interface ReceiptImageDto {id:string;receiptId:string;mimeType:string;sizeBytes:string;completedAt:string|null;contentSha256:string}
export interface ReceiptListDto {receipts:ReceiptDto[];images:ReceiptImageDto[]}
export interface ReceiptOptions {enabled:boolean;retentionDays:number|null;limits:{imageCount:number;imageBytes:number;totalImageBytes:number;imagesPerReceipt:number};mimeTypes:string[];heicSupported:boolean}
export const receiptResources={
  options:()=>apiClient.request<ReceiptOptions>('/expense-receipt-options'),
  list:(dayId:string)=>apiClient.request<ReceiptListDto>(`/expense-days/${dayId}/receipts`),
  command:<T,>(path:string,body:unknown,key:string,method="POST")=>apiClient.request<T>(path,{method,headers:{"idempotency-key":key},body:JSON.stringify(body)}),
  result:(key:string,operation:string)=>apiClient.request<{status:"succeeded"|"unknown";resourceId:string|null}>(`/expense-receipt-operations/${key}?${new URLSearchParams({operation})}`),
  uploadAccess:(id:string)=>apiClient.request<{url:string;method:"PUT";headers:Record<string,string>}>(`/expense-receipt-images/${id}/upload-access`),
  image:(id:string)=>apiClient.blob(`/expense-receipt-images/${id}/file`),
};
