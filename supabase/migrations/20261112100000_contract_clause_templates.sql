-- Editable source of the narrative terms-and-conditions text for the two
-- generated contract agreement PDFs (SPEC item 61). One row per numbered
-- section, keyed by (category, clause_key), so a later admin UI can edit
-- wording without touching PDF-generation code — the generator just
-- queries this table ordered by sort_order and renders heading + body.
--
-- Deliberately does NOT hold the structured sections (parties, vehicle
-- description, contract/fee tables, signature blocks): those render
-- directly from contracts/clients/vehicles columns, not from editable
-- prose, and have no business being hand-edited per contract.
create table public.contract_clause_templates (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('rent_to_own', 'rental')),
  clause_key text not null,
  sort_order integer not null,
  heading text not null,
  body text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (category, clause_key)
);

-- Serves "this category's active clauses, in order" directly — the only
-- query the PDF generator runs against this table.
create index contract_clause_templates_category_sort_idx
  on public.contract_clause_templates (category, sort_order)
  where is_active;

alter table public.contract_clause_templates enable row level security;

-- Same access model as contracts itself (contracts_manage): admin/manager
-- only, both to read while generating the PDF and to edit via the future
-- admin UI. Techs have no business need for contract document content.
create policy contract_clause_templates_manage on public.contract_clause_templates
  for all to authenticated
  using (public.is_manager_or_admin())
  with check (public.is_manager_or_admin());

create trigger set_contract_clause_templates_updated_at
  before update on public.contract_clause_templates
  for each row execute function public.set_updated_at();

-- Seed: current wording from the two source agreements (Rental_agreement
-- MAD8264S for rent_to_own; the "Friends & Family" short-form agreement
-- for rental), lightly reflowed from their source line-wrapping. The
-- rental category's dispute_resolution clause replaces the original's
-- named-mediator wording with a neutral SA mediation/arbitration clause,
-- per explicit scoping ("minus anything clearly specific to one person's
-- deal, like the Rabbi clause").
insert into public.contract_clause_templates (category, clause_key, sort_order, heading, body) values
('rent_to_own', 'contract_summary', 0, 'SAR2O Contract Summary', $body$The vehicle being used is rented from and owned by SA Rent 2 Own. This vehicle is being rented, NOT financed — payments do not reduce the residual whatsoever.

1. Client agrees all details supplied and noted in the contract are true and up to date.
2. The car is at the customer's full responsibility from the start of the contract — the vehicle is to be serviced on time.
3. Delay of payment without justification and direct contact with us will lead to the car being switched off, with a 48-hour delay before it is switched back on.
4. A surcharge of R500 will be charged in case of any and every returned debit order.
5. In case of accident, theft or hijacking, please contact us first before the police. Please then follow normal procedure, e.g. opening a police case.
6. Services must be done on time as per the vehicle computer and SA Rent 2 Own notification. Lack of cooperation from the client side will result in breach of contract and confiscation of our vehicle. All services are done at the SA Rent 2 Own Randburg branch unless advised differently by the service provider. The first service will be due at 5,000km or 6 months, whichever comes first — thereafter at every 15,000km.
7. The car may be driven by SA Rent 2 Own approved drivers only.
8. Insurance excess is the greater of R5,000 or 5%. If a head-on collision, the excess is R15,000.
9. The December debit order is processed on the 15th.
10. End-of-contract options will be explained by the salesman.
11. The client is provided 3,000km per month, or as agreed; any km thereafter is billed.$body$),

('rent_to_own', 'definitions', 1, '1. Definitions', $body$In this agreement, unless the context indicates otherwise, the following expressions shall bear the following meanings:

1.1 "the LICENCEE", "us" and "we" means SA Rent 2 Own, its sub-licensees and rental agencies.
1.2 "the RENTER" or "you" means renter 1 and/or renter 2 and includes the driver of the vehicle, as indicated overleaf.
1.3 "the DRIVER" means you and/or the driver and/or the additional driver as stipulated overleaf.
1.4 "the VEHICLE" means the vehicle(s) identified in this document, or any replacement vehicle provided to you by us (including keys, tyres, tools and accessories supplied with the vehicle).
1.5 "the RENTAL PERIOD" means the period between the "Date out" and the "Termination Date and Time" as specified overleaf, or, if such period is extended, the time and date entered on the Licencee's records.
1.6 "the OFFICIAL RATES" means our rates charged from time to time and/or in terms of the official rates published and amended from time to time, applicable to the vehicle rented in terms of this agreement and which are available at our office.$body$),

('rent_to_own', 'risk_and_delivery', 2, '2. Risk and Delivery', $body$2.1 The vehicle shall be at your sole risk from the date and time of delivery of the vehicle until the vehicle is returned to us. You undertake to return the vehicle undamaged, in good order and in a roadworthy condition, fair wear and tear accepted. The onus is on you to inspect the vehicle immediately upon delivery to ensure that it is free of any defects and is not damaged or scratched; your failure to do so, and to report the same to us, shall result in the vehicle being deemed to be in good condition, order and repair, and you shall accordingly be liable for any and all damages to the vehicle and the related charges.

2.2 If you do not exercise the option to purchase the vehicle contained in clause 5, you shall return the vehicle, on the expiry or termination of this agreement, at your expense, to our authorised representative at the termination location described overleaf or such other location as agreed to by us and confirmed in this document. The renter acknowledges that failure to return the vehicle in terms of this agreement shall constitute illegal possession, subject to criminal sanctions, and the Licencee may repossess the vehicle wherever it may be found and from whomsoever is in possession of it.

2.3 If the renter or the driver or any person nominated overleaf returns the vehicle to any branch of the Licencee, they shall:
2.3.1 park the vehicle in the Licencee's reserved parking;
2.3.2 ensure that the vehicle is properly locked and secure;
2.3.3 hand the keys to an authorised representative of the Licencee at the Licencee's offices where the office is open for business;
2.3.4 obtain a receipt from an authorised representative of the Licencee.

2.4 The sole risk of loss or damage to the vehicle shall remain vested in you until such time as we have recorded the return of the vehicle.

2.5 If the vehicle has a tracking device installed, any and all information obtained by us from that device shall be prima facie proof of all readings and recordings in respect of the vehicle, and we shall be entitled to use it in any legal proceedings.

2.6 Ownership of the vehicle shall always remain vested in us until such time as you have chosen to exercise the option and made payment of the amount required to purchase the vehicle, at which time ownership shall be transferred to you.$body$),

('rent_to_own', 'warranties', 3, '3. Warranties by You', $body$You warrant that:

3.1 all information given by you to us is true and correct;
3.2 the driver holds a valid driver's licence for the vehicle, has not been convicted of any criminal offence which resulted in the endorsement or cancellation of their licence, and will not drive the vehicle under the influence of alcohol or any other central nervous system stimulant;
3.3 neither you nor the driver are physically prevented from operating the vehicle safely;
3.4 no person other than the driver and/or additional driver recorded in this agreement shall drive the vehicle;
3.5 the driver will lock the vehicle and activate any burglar alarm or protection system installed in the vehicle when it is not in use, and ensure that the keys are properly controlled and kept either on your person and/or in your safe custody;
3.6 the vehicle shall not be used or driven for the conveyance of persons or property for hire, in any race, speed test or contest, or on roads not properly constructed;
3.7 the vehicle shall not be used or driven in any way which would constitute a contravention of, or breach of, any law or any of the provisions of this agreement. In breach of 3.7, SA Rent 2 Own reserves the right to terminate the contract and proceed with any applicable criminal charges;
3.8 you and/or the driver shall at all times display an absolute duty of care towards the Licencee in respect of the vehicle, ensuring that it is only used on suitable roads and conditions in accordance with the type of vehicle hereby rented;
3.9 the vehicle has been rented on the basis that you are not a tour operator or agent/representative for the Licencee. You further warrant that the vehicle is being used for leisure travel and not for the conveyance of passengers or freight for reward, and is not rented for the purposes of cross-border road transport as defined by the relevant Act;
3.10 neither you nor any third party (authorised or unauthorised) are allowed to use the vehicle in contravention of any Customs and Excise Act;
3.11 the vehicle may be subject to physical inspection on request.$body$),

('rent_to_own', 'payments', 4, '4. Payments', $body$You agree to pay us upon demand:

4.1.1 the vehicle rental rates as set out overleaf and/or in terms of our official rates, whichever may be applicable;
4.1.2 all delivery and collection charges as stipulated overleaf;
4.1.3 all traffic fine admin fees, e-toll surcharges/admin fees per toll transaction, rental admin fees, taxes, charges, stamp duties, levies, legal costs and tolls payable by us to any third party arising out of your use of the vehicle — it being recorded that you will pay R450 upon signature of this agreement as an e-toll deposit, and will be required to make further monthly payments upon demand to ensure such deposit is maintained; consent to use the vehicle is granted provided you remain in credit (advance) of the payment schedule, and such consent may be revoked at any point if you fall into arrears;
4.1.4 all and any costs (including but not limited to) towing charges, losses or damages and charges incurred by us in procuring the return of the vehicle to the terminating location described above, or such other location as determined by us;
4.1.5 in the event that the vehicle is not returned on the return date, all amounts that would have been payable by you in terms of this agreement if the rental period had been validly extended to the actual date of return of the vehicle to us;
4.1.6 all costs incurred by us in repairing any damage of any nature whatsoever to the vehicle, including but not limited to damage to the windscreen and/or tyres, keys (fair wear and tear accepted), and any loss or damages suffered by us as a result of theft, fire or any other cause whatsoever;
4.1.7 such valet charge as may be levied for cleaning of the vehicle;
4.1.8 such accident admin fee, assessor's fee and traffic offence/toll handling fee, in an amount of R150, as may be levied by us;
4.1.9 the liability amount as stipulated overleaf in respect of the waivers, on the date of the incident/accident, irrespective of who caused and/or was negligent;
4.1.10 monthly insurance premiums in accordance with clause 6 below, and any excess payments due in terms of any claim made in respect of the vehicle;
4.1.11 the non-refundable documentation and initiation fee overleaf;
4.1.12 such costs as are determined in accordance with the service contained in clause 7;
4.1.13 such charges, in an amount of R49 per month per additional nominated driver, subsequent to nominating an additional driver;
4.1.14 any additional charges in respect of kilometres driven in excess of the permitted kilometres, as per clause 11.17 overleaf.

4.2 If we have agreed to payment from you by credit or charge card, your signature shall constitute authority for the issuer of the card to immediately debit you with the total amount agreed upon, inclusive of all costs and charges of whatsoever nature arising in terms of this agreement.

4.3 All additional charges as indicated overleaf shall be payable by you. All charges may be debited to your credit card from such authorisation, and/or deducted from any deposit paid. These amounts shall be non-refundable until such time as we have raised all charges payable in terms of this agreement; any balance then owing shall immediately be refunded/released to you.

4.4 You shall pay all amounts payable by you under this agreement to us, on demand. If any payment is not made on its due date, then we may, without prejudice to any of our rights, charge interest on the amount due at the maximum rate permissible by law.

4.5 All rental payments as set out in the schedule attached hereto are to be paid by way of advance debit order, as confirmed overleaf, in accordance with the debit order authorisation attached to this agreement, which is required to be completed by you.

4.6 In the event, for any reason, of a returned debit order, we shall levy a charge of R500 per incident onto the renter, payable immediately.

4.7 A returned debit order effected by the client for reason of "no authority to debit" or any derivation thereof will result in immediate termination of the contract, with all outstanding monies falling due and payable.

Note:
— The vehicle may be switched off immediately following failure to make payment as per the agreed schedule, and any such charges that may arise for reinstatement of the vehicle once payment is tendered shall be levied onto the client.
— Switched-off vehicles may take 48 hours to reinstate upon receipt of payment.
— Should a switch-off notice be issued and the vehicle is still used after that point for whatever reason, it shall be deemed as used without consent.$body$),

('rent_to_own', 'option', 5, '5. Option', $body$5.1 You shall have the option, at the expiry of this agreement, to purchase the vehicle for the amount as set out overleaf.
5.2 Should you elect to exercise this option, you are required to notify us in writing no later than 60 days prior to the end of this agreement.
5.3 Once the option has been exercised, you will be required to have your finance in place no later than 14 days prior to the end of this agreement.$body$),

('rent_to_own', 'insurance', 6, '6. Insurance', $body$6.1 We shall, through our insurance broker, provide comprehensive insurance for the vehicle, the cost of which is included in the instalment set out overleaf and payable by you.
6.2 For any driver under the age of 25, or with less than five years' driving experience, the excess will increase. The standard excess shall be the higher of R5,000 or 5% of the total claim; should the vehicle be involved in a front-end accident, the excess will exceed 5% and be capped at R15,000.
6.2.1 No loan car will be provided until the excess is paid in full.
6.3 Should you attempt to tamper with and/or remove the tracking device installed in the vehicle, such action will constitute theft of the vehicle, and we shall proceed with the appropriate criminal charges.
6.4 Taking the vehicle across the border without our prior written consent also constitutes theft of the vehicle, and we shall proceed to lay criminal charges in such an event.
6.5 The driver shall not take the vehicle into any area or on any road where there is a risk that the vehicle may be damaged, stolen or lost through civil disturbance, riot or any act of political unrest.
6.6 You shall be liable for all damage suffered by us if the driver contravenes this clause for any reason whatsoever.
6.7 Specifically, the liability waiver in this paragraph will no longer be valid, and the damage noted in 6.2 shall be for your full account.
6.8 Insurance information is set out in the applicable addendum, and the signing of this document constitutes acceptance of that addendum and the information therein.$body$),

('rent_to_own', 'service', 7, '7. Service', $body$7.1 You shall be required to bring the vehicle into a designated servicing department annually, or as per the manufacturer's specifications, whichever occurs first, for us to perform a service on the vehicle.
7.2 Should it be found that you have abused the vehicle and/or the undercarriage in any manner whatsoever, such charges will be for your account, fair wear and tear accepted; it will be in our sole discretion as to what constitutes abuse.
7.3 Failure to service at the designated times constitutes a breach of this agreement.
7.4 On completion of service, the vehicle may be collected by yourself, provided authority has not been revoked by us, or by a representative or nominated party.$body$),

('rent_to_own', 'breach', 8, '8. Breach', $body$8.1 We shall be entitled to terminate this agreement if you and/or the driver commit any breach of this agreement. We shall then be entitled to the immediate return of the vehicle. You will have 21 days thereafter to remedy the breach and effect return of the car. Furthermore, any amount then owing by you to us will become immediately due, owing and payable.
8.2 Both your and our rights and obligations under this agreement shall continue to be in full force and effect until such time as the vehicle has been returned to us and you have complied with your obligations in terms hereof.$body$),

('rent_to_own', 'indemnity', 9, '9. Indemnity', $body$9.1 Save as provided for in law, and provided that there was no negligence on our part, the Licencee shall not be liable for any damage and/or injury and/or death arising out of any defect in and/or mechanical failure of the vehicle, or any apparel therein including, but not limited to, a baby seat, nor for any loss or damages to any property transported in or left in the vehicle, nor for any damages, injury, death, consequential loss, loss of profits, or any other damages which the renter or the driver or any person transported in the vehicle or any other person may suffer arising out of the agreement. You indemnify us in full in this regard.$body$),

('rent_to_own', 'responsibility_after_loss', 10, '10. Responsibility After Loss or Damage to Vehicle', $body$If the vehicle is involved in any accident or collision, or is lost, or the vehicle or any part of it is stolen, or is involved in any incident which could prejudice our rights, the driver shall take all such steps to safeguard our interests, including but not limited to the following, where appropriate:

10.1.1 obtain the name and address of everyone involved and of possible witnesses;
10.1.2 not admit any responsibility or liability, or release any party from any liability or potential liability, nor settle any claim or potential claim against or by any party, nor accept any disclaimer of liability;
10.1.3 notify the police and obtain an accident report and case number as soon as possible, and notify us within 24 hours of the incident;
10.1.4 within 48 hours of the incident, complete and furnish to us our fully completed standard claim form;
10.1.5 within 48 hours of the incident, submit a copy of their driver's licence to us;
10.1.6 submit photos of all damage to the vehicle to the email address we provide;
10.1.7 make adequate provision for the safety and security of the vehicle;
10.1.8 cooperate with us and our insurer in any investigation, the lodging or instituting of any claim or action, and the defence of any prosecution, claim or action relating to the above;
10.1.9 if you are not the driver, you shall, without in any way detracting from your own obligations, ensure that the driver complies with the provisions of this clause 10. If you are not the driver and the driver does not comply, you shall automatically become liable for all damages, including third-party claims;
10.1.10 furnish us (and, if you are not the driver, ensure that the driver furnishes us) with any notice of claim, demand, summons or the like which you or the driver may receive in that regard;
10.1.11 the driver shall not be entitled to effect any repairs to the vehicle, whether mechanical, structural or otherwise, without our prior written consent.

10.2 We reserve the right to claim for all damages (including undercarriage damage to the vehicle, which is not covered by the insurance policy) resulting from this rental, within a reasonable period from the date of termination of this rental.

10.3 If towing is required, it is only to be done by our nominated company. If an alternate company is used without our express consent, the towing charge will be for the customer's account.$body$),

('rent_to_own', 'general', 11, '11. General', $body$11.1 You acknowledge that ownership in the vehicle shall at all times remain vested in us, or the true owner of the vehicle.
11.2 You shall not be entitled to cede or assign any of your rights and obligations under this agreement, or to sublet or part with possession of the vehicle, its tools or equipment or any part of it.
11.3 The cost of fuel is not included in the amount of the rental.
11.4 Any tampering by you with the odometer or tracking device of the vehicle will be regarded as fraud. Where required in determining the rental charges, the distance driven by you or the driver shall be measured from the odometer installed in the vehicle; if such calculation is not practical or possible for any reason, it shall be done by such other reasonable method as we may determine, and you shall be obliged to furnish all such information and assistance as we may reasonably require for that purpose.
11.5 If the renter is not the driver, then, without detracting from the renter's obligations in terms of this agreement, the renter and the driver shall be liable to the Licencee jointly and severally for any and all amounts owing under this agreement, including but not limited to damages.
11.6 Please be advised that, although we shall use our best efforts, we are unable to guarantee delivery of the vehicle to you at a particular time due to circumstances beyond our control. In the event that we are unable to do this, we shall endeavour to make alternative arrangements until we are able to deliver the vehicle to you.
11.7 Save as otherwise stated in this agreement, any addition to, alteration or cancellation of this agreement shall be null and void unless agreed upon by us in writing.
11.8 The parties consent to the jurisdiction of the Magistrate's Court having territorial jurisdiction over the parties, for all purposes under this agreement, notwithstanding that the subject matter or cause of action involved may otherwise be beyond the jurisdiction of that court.
11.9 You choose the address where you will receive notices for all purposes in terms of this agreement at the renter's address specified overleaf, or, in the case of an address not in the Republic of South Africa, at the driver's local address specified overleaf. The client is to notify us in writing, no more than ten days after the fact, of any change of residential address, work address or employment details.
11.10 A certificate by any director, manager or accountant of ours as to the amount owed by you to us shall, on the face of it, constitute proof of the amount owing.
11.11 This document contains the entire agreement between the parties regarding the matters contained herein, and the Licencee shall not be bound by any undertakings, representations, warranties, promises or the like not recorded herein, unless otherwise stipulated by law.
11.12 It is agreed that each clause of these terms and conditions is severable from the others, and if any clause is found to be defective or unenforceable for any reason by any competent court, the remaining clauses shall continue to be of full force and effect.
11.13 This agreement shall be governed by and interpreted in accordance with the laws of the Republic of South Africa.
11.14 The renter hereby consents to and authorises the Licencee to disclose all relevant information of the renter/driver to SANRAL for the recovery of any e-toll transaction in respect of the driving of the vehicle.
11.15 The renter consents to any credit/information check that may become necessary.
11.17 The permitted km usage per month on this contract is as set out overleaf (3,000km unless otherwise stipulated). Any mileage over and above that allowance will be billed in arrears at R1.70 per km, with a credit limit of not more than R2,000.
11.18 Clients are billed by debit order automatically on reaching the R2,000 limit. First debit-order failure results in vehicle shutdown until the km account is settled.
11.19 Unused km are accumulative for the duration of the contract.$body$),

('rent_to_own', 'debit_order_mandate', 12, 'Debit Order Mandate', $body$FRB Minimum Requirements for Written Authority and Mandate for Debit Payment Instructions

A. Authority

I hereby authorise SA Rent 2 Own's bank, on behalf of SA Rent 2 Own, to issue and deliver payment instructions to my bank for collection against my nominated account (or any other account or bank to which I may transfer it), on condition that the sum of such payment instructions will never exceed my obligations as agreed to in this agreement, commencing on the date recorded on my debit order authorisation and continuing until this authority and mandate is terminated by me giving notice in writing of not less than 20 ordinary working days, sent by prepaid registered post or delivered to SA Rent 2 Own's address.

The individual payment instructions so authorised shall be issued and delivered monthly, unless otherwise agreed in writing.

In the event that the payment day falls on a Sunday or recognised South African public holiday, the payment day will automatically be the preceding ordinary business day.

I understand that the withdrawals hereby authorised will be processed through a computerised system provided by the South African banks. I also understand that details of each withdrawal will be printed on my bank statement, and that such must contain a number which must be included in the payment instruction so that I can identify the agreement.

I agree to pay SA Rent 2 Own, upon demand, all traffic fine admin fees, e-toll surcharges/admin fees per toll transaction, rental admin fees, taxes, charges, stamp duties, levies, legal costs and tolls payable by them to any third party arising out of my use of the vehicle, and I will be required to make further monthly payments upon demand.

B. Mandate

I acknowledge that all payment instructions issued by SA Rent 2 Own shall be treated by my bank as if the instructions had been issued by me personally.

C. Cancellation

I agree that, although this authority and mandate may be cancelled by me, such cancellation will not cancel the agreement. I shall not be entitled to any refund of amounts withdrawn while this authority was in force, if such amounts were legally owing.

D. Assignment

I acknowledge that this authority may be ceded or assigned to a third party if the agreement is also ceded or assigned to that third party, but, in the absence of such assignment of the agreement, this authority and mandate cannot be assigned to any third party.

E. Agreement Reference Number

This agreement reference number is the deal number assigned to this contract.$body$),

('rental', 'use_of_vehicle', 1, '4. Use of Vehicle', $body$The Driver agrees to use the vehicle lawfully, responsibly and only for lawful purposes.$body$),

('rental', 'insurance_excess', 2, '5. Insurance & Non-Waivable Excess', $body$The vehicle is insured; however, the Driver shall remain liable for:
• Up to R5,000 for any damage per incident.
• Up to R15,000 for frontal damage per incident (including bumper, bonnet, headlights, grille, radiator and sensors).
These amounts apply regardless of fault, insurance outcome or third-party recovery.$body$),

('rental', 'negligence', 3, '6. Negligence & Improper Use', $body$The Driver is liable for all damage caused by negligence, including ignoring warning lights, overheating, using the wrong fuel, reckless driving or failing to report mechanical issues.$body$),

('rental', 'accidents_reporting', 4, '7. Accidents & Reporting', $body$• Report all accidents immediately.
• Open a police case within 24 hours.
Failure to comply renders the Driver liable for the full repair cost.$body$),

('rental', 'fines_violations', 5, '8. Fines & Violations', $body$The Driver is responsible for all fines, tolls and traffic offences during the rental period.$body$),

('rental', 'prohibited_use', 6, '9. Prohibited Use', $body$The vehicle may not be used for Uber, deliveries or sub-rental without the Owner's written consent.$body$),

('rental', 'dispute_resolution', 7, '10. Dispute Resolution', $body$Should any dispute arise under this agreement, both parties agree to first attempt to resolve it through good-faith negotiation. If the dispute cannot be resolved within 14 days, either party may refer it to mediation with a mediator appointed by mutual agreement, or, failing agreement, appointed by the Arbitration Foundation of Southern Africa (AFSA). Should mediation fail, the dispute shall be referred to arbitration in accordance with the AFSA rules then in effect, before legal proceedings are instituted.$body$),

('rental', 'termination', 8, '11. Termination', $body$The Owner may terminate this agreement in the event of a breach or improper use.$body$),

('rental', 'governing_law', 9, '12. Governing Law', $body$This agreement shall be governed by the laws of the Republic of South Africa.$body$);
