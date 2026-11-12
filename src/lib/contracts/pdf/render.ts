import "server-only";

import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { createElement, type ReactElement } from "react";

import { RentalDocument } from "./rental-document";
import { RentToOwnDocument } from "./rent-to-own-document";
import type { AgreementCategory, AgreementData } from "./types";

export async function renderAgreementPdf(category: AgreementCategory, data: AgreementData): Promise<Buffer> {
  const Doc = category === "rent_to_own" ? RentToOwnDocument : RentalDocument;
  // Both components' root element is a <Document>, satisfying renderToBuffer
  // at runtime; TS can't trace that through a wrapper component's own prop
  // type, hence the cast.
  return renderToBuffer(createElement(Doc, { data }) as ReactElement<DocumentProps>);
}
