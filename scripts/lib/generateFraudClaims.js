const FIRST_NAMES = [
  "Michael", "Sarah", "James", "Emma", "Daniel", "Priya", "Oliver", "Aisha",
  "Thomas", "Sophie", "Ryan", "Fatima", "George", "Chloe", "Marcus", "Leila",
  "Ben", "Hannah", "Kieran", "Zara", "Adam", "Megan", "Liam", "Nadia",
  "Jack", "Ella", "Noah", "Yasmin", "Ethan", "Grace",
];

const LAST_NAMES = [
  "Turner", "Chen", "Okonkwo", "Patel", "Williams", "Murphy", "Khan", "Taylor",
  "Singh", "Brown", "Ali", "Davies", "Roberts", "Ahmed", "Wilson", "Martin",
  "Thompson", "Hussain", "Clark", "Lewis", "Walker", "Hall", "Young", "King",
  "Wright", "Scott", "Green", "Baker", "Hill", "Adams",
];

const GARAGES = [
  { name: "FastTrack Prestige Repairs Ltd", claimsLast60Days: 9 },
  { name: "Metro Collision Centre", claimsLast60Days: 7 },
  { name: "East End Auto Body", claimsLast60Days: 6 },
  { name: "Premier Motor Repairs", claimsLast60Days: 8 },
  { name: "North London Motors Ltd", claimsLast60Days: 3 },
];

const VEHICLES = [
  { model: "2022 BMW M340i", reg: "YD22", value: 34000 },
  { model: "2021 Audi A4", reg: "OY21", value: 28000 },
  { model: "2020 Mercedes C220", reg: "LK20", value: 26500 },
  { model: "2023 VW Golf R", reg: "BT23", value: 38000 },
  { model: "2019 Range Rover Evoque", reg: "WF19", value: 42000 },
  { model: "2022 Tesla Model 3", reg: "EV22", value: 36000 },
];

const { vehicleFromUkCatalog } = require("../../src/engine/vehicleFields");

const LOCATIONS = [
  "A406 North Circular Road, London",
  "M25 Junction 15, Surrey",
  "A10 Cambridge Heath Road, London",
  "A40 Western Avenue, London",
  "M1 Junction 8, Buckinghamshire",
  "A13 Commercial Road, London",
  "A316 Twickenham Road, Middlesex",
  "A205 South Circular, London",
];

const FRAUD_PROFILES = [
  {
    reportingDelayHours: 52,
    photoMetadataPredatesLoss: true,
    photoMetadataDeltaDays: 2,
    bankAccountUpdatedHoursBeforeClaim: 18,
    expeditedSettlementRequested: true,
    customerServiceContacts24h: 5,
    fraudNotes: "SIU review — photo EXIF predates loss; settlement account changed 18h before FNOL.",
  },
  {
    reportingDelayHours: 36,
    repairEstimateHoursAfterReport: 2,
    repairGarageClaimsLast60Days: 8,
    expeditedSettlementRequested: true,
    customerServiceContacts24h: 4,
    fraudNotes: "Garage cluster alert — estimate within 2h; FastTrack linked to 8 claims in 60 days.",
  },
  {
    policyUpgradeDaysBeforeLoss: 14,
    protectedNcbAdded: true,
    reducedExcessAdded: true,
    claimValueGbp: 18500,
    vehicleValueGbp: 34000,
    fraudNotes: "Cover upgraded 14 days pre-loss — protected NCB and reduced excess added.",
  },
  {
    thirdPartyInvolved: true,
    policeReportProvided: false,
    witnessCount: 0,
    claimValueGbp: 14200,
    fraudNotes: "Third-party RTA — no police report, no witnesses, high value.",
  },
  {
    deviceLinkedToInvestigations: true,
    linkedInvestigationPolicyCount: 3,
    previousQuoteAttempts: 6,
    fraudNotes: "Device fingerprint linked to 3 prior fraud investigations; 6 quote attempts.",
  },
  {
    reportingDelayHours: 72,
    photoMetadataPredatesLoss: true,
    bankAccountUpdatedHoursBeforeClaim: 12,
    repairGarageClaimsLast60Days: 7,
    fraudNotes: "Multiple red flags — delayed FNOL, predated photos, account change, garage cluster.",
  },
  {
    claimValueGbp: 22000,
    vehicleValueGbp: 38000,
    witnessCount: 0,
    repairEstimateHoursAfterReport: 3,
    fraudNotes: "Loss ratio 58% with no witnesses; rapid garage estimate.",
  },
  {
    policyUpgradeDaysBeforeLoss: 21,
    protectedNcbAdded: true,
    expeditedSettlementRequested: true,
    customerServiceContacts24h: 6,
    fraudNotes: "Recent cover change + repeated settlement pressure calls.",
  },
  {
    previousQuoteAttempts: 5,
    reportingDelayHours: 40,
    thirdPartyInvolved: true,
    policeReportProvided: false,
    fraudNotes: "Quote shopping pattern; delayed reporting on third-party incident.",
  },
  {
    photoMetadataPredatesLoss: true,
    repairGarageClaimsLast60Days: 9,
    bankAccountUpdatedHoursBeforeClaim: 6,
    fraudNotes: "Critical combo — staged photo metadata, networked garage, fresh bank details.",
  },
];

function pick(arr, index) {
  return arr[index % arr.length];
}

function generateFraudClaims(count = 50, startIndex = 0) {
  const claims = [];
  const baseDate = new Date("2026-06-01T00:00:00Z");

  for (let i = 0; i < count; i++) {
    const idx = startIndex + i;
    const profile = FRAUD_PROFILES[idx % FRAUD_PROFILES.length];
    const first = pick(FIRST_NAMES, idx);
    const last = pick(LAST_NAMES, idx + 7);
    const vehicle = pick(VEHICLES, idx + 3);
    const ukVehicle = vehicleFromUkCatalog(idx, 2018 + (idx % 6));
    const garage = pick(GARAGES, idx + 2);
    const location = pick(LOCATIONS, idx);

    const lossOffsetDays = 3 + (idx % 20);
    const dateOfLoss = new Date(baseDate);
    dateOfLoss.setDate(dateOfLoss.getDate() + lossOffsetDays);
    const dateReported = new Date(dateOfLoss);
    dateReported.setHours(
      dateReported.getHours() + (profile.reportingDelayHours || 8 + (idx % 12))
    );

    const claimValueGbp =
      profile.claimValueGbp || 8500 + (idx % 12) * 750 + (idx % 3) * 1200;
    const vehicleValueGbp = profile.vehicleValueGbp || vehicle.value;

    const batchRef = `CLM-2026-${String(5001 + idx).padStart(6, "0")}`;

    claims.push({
      batchRef,
      accountId: `acc_${first.toLowerCase()}_${last.toLowerCase()}_${idx}`,
      customerName: `${first} ${last}`,
      policyNumber: `POL-${88000000 + idx}`,
      dateOfLoss: dateOfLoss.toISOString(),
      dateReported: dateReported.toISOString(),
      claimType: idx % 5 === 0 ? "Theft" : "Motor Accident",
      claimStatus: "Under Review",
      claimValueGbp,
      vehicle: ukVehicle.vehicle,
      vehicleMake: ukVehicle.make,
      vehicleModel: ukVehicle.model,
      vehicleColour: ukVehicle.colour,
      vehicleYear: ukVehicle.vehicleYear,
      vehicleRegistration: ukVehicle.vehicleRegistration,
      vehicleValueGbp: profile.vehicleValueGbp || vehicle.value,
      locationOfIncident: location,
      thirdPartyInvolved: profile.thirdPartyInvolved ?? idx % 3 !== 0,
      policeReportProvided: profile.policeReportProvided ?? idx % 4 === 0,
      witnessCount: profile.witnessCount ?? (idx % 5 === 0 ? 1 : 0),
      passengerCount: 0,
      repairGarage: garage.name,
      reportingDelayHours:
        profile.reportingDelayHours ?? 28 + (idx % 24),
      repairEstimateHoursAfterReport:
        profile.repairEstimateHoursAfterReport ?? 2 + (idx % 4),
      policyUpgradeDaysBeforeLoss:
        profile.policyUpgradeDaysBeforeLoss ?? (idx % 6 === 0 ? 18 + (idx % 10) : 90),
      policyActiveMonths: 3 + (idx % 18),
      previousQuoteAttempts: profile.previousQuoteAttempts ?? 2 + (idx % 5),
      previousClaimsDeclared: idx % 7 === 0 ? 1 : 0,
      photoMetadataPredatesLoss: profile.photoMetadataPredatesLoss ?? idx % 8 === 0,
      photoMetadataDeltaDays: profile.photoMetadataDeltaDays ?? (idx % 3) + 1,
      expeditedSettlementRequested:
        profile.expeditedSettlementRequested ?? idx % 2 === 0,
      customerServiceContacts24h:
        profile.customerServiceContacts24h ?? 2 + (idx % 5),
      bankAccountUpdatedHoursBeforeClaim:
        profile.bankAccountUpdatedHoursBeforeClaim ??
        (idx % 6 === 0 ? 12 + (idx % 36) : null),
      deviceLinkedToInvestigations:
        profile.deviceLinkedToInvestigations ?? idx % 9 === 0,
      linkedInvestigationPolicyCount:
        profile.linkedInvestigationPolicyCount ?? (idx % 3) + 1,
      repairGarageClaimsLast60Days:
        profile.repairGarageClaimsLast60Days ?? garage.claimsLast60Days,
      protectedNcbAdded: profile.protectedNcbAdded ?? idx % 7 === 0,
      reducedExcessAdded: profile.reducedExcessAdded ?? idx % 5 === 0,
      reportingDelayReason:
        idx % 4 === 0 ? "Mobile phone damaged in collision" : "Delayed due to travel",
      description: `Motor claim ${batchRef} — ${location}. Policyholder reports ${
        idx % 3 === 0 ? "single vehicle" : "third-party"
      } incident; handler flagged for profiler review.`,
      fraudNotes:
        profile.fraudNotes ||
        `Automated fraud alert seed ${idx + 1} — multiple suspect indicators on ${batchRef}.`,
      insuredVehicleLabel: [ukVehicle.make, ukVehicle.model].filter(Boolean).join(" "),
      fraudFlag: true,
    });
  }

  return claims;
}

module.exports = { generateFraudClaims };
