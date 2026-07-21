import "server-only";

import type { DocumentData } from "firebase-admin/firestore";

import { adminDb } from "@/lib/firebase/admin";

import type { Order, OrderLine, OrderStatus, OrderTotals } from "../domain/types";

export function ordersCollection(companyId: string) {
  return adminDb.collection("companies").doc(companyId).collection("orders");
}

export function orderDoc(companyId: string, orderId: string) {
  return ordersCollection(companyId).doc(orderId);
}

export function linesCollection(companyId: string, orderId: string) {
  return orderDoc(companyId, orderId).collection("lines");
}

export function lineDoc(companyId: string, orderId: string, lineId: string) {
  return linesCollection(companyId, orderId).doc(lineId);
}

export function toOrder(id: string, data: DocumentData): Order {
  return {
    id,
    branchId: data.branchId,
    appId: data.appId,
    status: data.status as OrderStatus,
    customerRef: data.customerRef,
    totals: data.totals as OrderTotals,
    createdBy: data.createdBy,
  };
}

export function toOrderLine(id: string, data: DocumentData): OrderLine {
  return {
    id,
    branchId: data.branchId,
    itemId: data.itemId,
    itemNameSnapshot: data.itemNameSnapshot,
    quantity: data.quantity,
    unitPrice: data.unitPrice,
    lineTotal: data.lineTotal,
  };
}
