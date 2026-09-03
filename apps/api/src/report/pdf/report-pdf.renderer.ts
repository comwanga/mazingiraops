import PDFDocument from "pdfkit";
import sharp from "sharp";
import type { AttendanceStatus } from "@ward-ops/contracts";
import type {
  ReportPhotoRef,
  ReportSnapshot,
} from "../report-aggregation";
import { canonicalSnapshotHash, RENDERER_VERSION } from "../report-aggregation";

export type ImageLoader = (objectKey: string) => Promise<Buffer | null>;

export interface PdfRenderOptions {
  imageLoader?: ImageLoader;
}

// Brand Palette (Nairobi City County Green / MazingiraOps Official Palette)
const COLOR = {
  primary: "#1b5e20",
  primaryDark: "#0f3e13",
  primaryLight: "#e8f5e9",
  accentGold: "#b45309",
  accentGoldLight: "#fef3c7",
  textDark: "#0f172a",
  textMuted: "#475569",
  textLight: "#94a3b8",
  border: "#cbd5e1",
  borderLight: "#e2e8f0",
  bgLight: "#f8fafc",
  bgSubtle: "#f1f5f9",
  white: "#ffffff",
  statusPresent: "#15803d",
  statusLate: "#b45309",
  statusAbsent: "#b91c1c",
  statusExcused: "#4338ca",
};

function formatDisplayDate(dateStr: string): string {
  try {
    const d = new Date(`${dateStr}T00:00:00.000Z`);
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  } catch {
    return dateStr;
  }
}

/**
 * Optimizes an evidence image buffer for bounded PDF embedding.
 * Keeps memory bounded (max 1200x900 JPEG, quality 80).
 */
async function optimizeImage(buffer: Buffer): Promise<Buffer | null> {
  try {
    return await sharp(buffer)
      .rotate() // auto-orient from EXIF
      .resize({ width: 1200, height: 900, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch {
    return null;
  }
}

export async function renderReportPdf(
  snapshot: ReportSnapshot,
  options: PdfRenderOptions = {},
): Promise<Buffer> {
  const doc = new PDFDocument({
    size: "A4",
    margins: { top: 40, bottom: 50, left: 40, right: 40 },
    bufferPages: true,
    autoFirstPage: true,
    info: {
      Title: `${snapshot.kind} Operations Report — ${snapshot.scopeName}`,
      Author: snapshot.signedBy ?? "MazingiraOps Official Reporting",
      Subject: `Operational Report for ${snapshot.scopeName} (${snapshot.startDate} to ${snapshot.endDate})`,
      Keywords: "MazingiraOps, Nairobi City County, Environment, Report",
      CreationDate: new Date(snapshot.generatedAt || Date.now()),
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));

  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right; // 595.28 - 80 = 515.28 pt
  const bottomThreshold = doc.page.height - doc.page.margins.bottom;

  function ensureSpace(requiredHeight: number) {
    if (doc.y + requiredHeight > bottomThreshold) {
      doc.addPage();
    }
  }

  // -------------------------------------------------------------------------
  // 1. Header & Official Branding
  // -------------------------------------------------------------------------
  function renderHeader() {
    const startY = doc.y;

    // Top decorative bar
    doc.rect(doc.page.margins.left, startY, contentWidth, 5).fill(COLOR.primary);
    doc.y = startY + 12;

    // Top Header Banner
    doc
      .fontSize(9)
      .font("Helvetica-Bold")
      .fillColor(COLOR.accentGold)
      .text("NAIROBI CITY COUNTY GOVERNMENT", { align: "center", characterSpacing: 1.5 });
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .fillColor(COLOR.primary)
      .text("SECTOR OF GREEN NAIROBI · ENVIRONMENT & NATURAL RESOURCES", {
        align: "center",
        characterSpacing: 0.8,
      });
    doc
      .fontSize(16)
      .font("Helvetica-Bold")
      .fillColor(COLOR.textDark)
      .text(snapshot.kind === "CUSTOM" ? "CUSTOM OPERATIONS REPORT" : `${snapshot.kind} OPERATIONS REPORT`, {
        align: "center",
        characterSpacing: 0.5,
      });

    doc.moveDown(0.3);

    // Meta ribbon
    const ribbonY = doc.y;
    doc
      .rect(doc.page.margins.left, ribbonY, contentWidth, 24)
      .fill(COLOR.bgSubtle);

    doc.rect(doc.page.margins.left, ribbonY, contentWidth, 24).stroke(COLOR.border);

    doc
      .fontSize(9)
      .font("Helvetica-Bold")
      .fillColor(COLOR.textDark)
      .text(
        `SCOPE: ${snapshot.scopeName.toUpperCase()} (${snapshot.scopeType})`,
        doc.page.margins.left + 10,
        ribbonY + 7,
      );

    const periodText = `PERIOD: ${formatDisplayDate(snapshot.startDate)} — ${formatDisplayDate(snapshot.endDate)}`;
    doc
      .font("Helvetica-Bold")
      .fillColor(COLOR.primaryDark)
      .text(periodText, doc.page.margins.left + contentWidth - 230, ribbonY + 7, {
        width: 220,
        align: "right",
      });

    doc.y = ribbonY + 32;
  }

  renderHeader();

  // -------------------------------------------------------------------------
  // 2. Executive Summary & KPIs
  // -------------------------------------------------------------------------
  function renderExecutiveSummary() {
    ensureSpace(120);
    const analytics = snapshot.analytics;
    const comparison = snapshot.comparison;

    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .fillColor(COLOR.primaryDark)
      .text("1. EXECUTIVE SUMMARY & KEY PERFORMANCE INDICATORS");
    doc.moveDown(0.4);

    // Summary Text Box
    const summaryText =
      `During this reporting period for ${snapshot.scopeName} (${snapshot.scopeType.toLowerCase()}), ` +
      `a total of ${analytics.uniquePersonnelAttended} personnel attended duty across ${analytics.totalWorkLogs} documented work operations. ` +
      `The effective attendance rate was ${analytics.effectiveAttendanceRate.toFixed(1)}% ` +
      `(expected on duty: ${analytics.expectedOnDuty}), with ${analytics.statusDistribution.ABSENT?.count ?? 0} absences recorded. ` +
      `Operations delivered ${analytics.totalTrips} waste collection/transfer trips and achieved a ${analytics.completionRate.toFixed(1)}% work completion rate ` +
      `across ${analytics.distinctActivitiesCount} operational activities.`;

    const summaryBoxY = doc.y;
    doc
      .rect(doc.page.margins.left, summaryBoxY, contentWidth, 42)
      .fillAndStroke(COLOR.bgLight, COLOR.borderLight);

    doc
      .fontSize(8.5)
      .font("Helvetica")
      .fillColor(COLOR.textDark)
      .text(summaryText, doc.page.margins.left + 8, summaryBoxY + 6, {
        width: contentWidth - 16,
        lineGap: 1.5,
      });

    doc.y = summaryBoxY + 48;

    // KPI Cards / Table with Preceding Period Comparison
    ensureSpace(90);

    const colWidth = contentWidth / 4;
    const kpiCards = [
      {
        title: "ATTENDANCE RATE",
        value: `${analytics.effectiveAttendanceRate.toFixed(1)}%`,
        kpi: comparison?.kpis.effectiveAttendanceRate,
        unit: "%",
      },
      {
        title: "ATTENDED / EXPECTED",
        value: `${analytics.attendedCount} / ${analytics.expectedOnDuty}`,
        kpi: comparison?.kpis.attendedCount,
        unit: "",
      },
      {
        title: "WORK TRIPS",
        value: `${analytics.totalTrips}`,
        kpi: comparison?.kpis.totalTrips,
        unit: "",
      },
      {
        title: "WORK COMPLETION",
        value: `${analytics.completionRate.toFixed(1)}%`,
        kpi: comparison?.kpis.completionRate,
        unit: "%",
      },
    ];

    const cardY = doc.y;
    const cardHeight = 44;

    kpiCards.forEach((card, idx) => {
      const cardX = doc.page.margins.left + idx * colWidth;
      doc
        .rect(cardX + 2, cardY, colWidth - 4, cardHeight)
        .fillAndStroke(COLOR.white, COLOR.border);

      doc
        .fontSize(7)
        .font("Helvetica-Bold")
        .fillColor(COLOR.textMuted)
        .text(card.title, cardX + 6, cardY + 5, { width: colWidth - 12 });

      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .fillColor(COLOR.primaryDark)
        .text(card.value, cardX + 6, cardY + 16, { width: colWidth - 12 });

      if (card.kpi) {
        const delta = card.kpi.absoluteChange;
        const deltaSign = delta > 0 ? "+" : "";
        const deltaStr = `${deltaSign}${delta}${card.unit} vs prev`;
        const deltaColor = delta >= 0 ? COLOR.primary : COLOR.statusAbsent;
        doc
          .fontSize(6.5)
          .font("Helvetica-Bold")
          .fillColor(deltaColor)
          .text(deltaStr, cardX + 6, cardY + 31, { width: colWidth - 12 });
      }
    });

    doc.y = cardY + cardHeight + 10;
  }

  renderExecutiveSummary();

  // -------------------------------------------------------------------------
  // 3. Attendance Analytics & Vector Visualizations
  // -------------------------------------------------------------------------
  function renderAttendanceAnalytics() {
    ensureSpace(170);
    const analytics = snapshot.analytics;

    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .fillColor(COLOR.primaryDark)
      .text("2. ATTENDANCE ANALYTICS & VECTOR VISUALIZATIONS");
    doc.moveDown(0.4);

    // Section Intro
    doc
      .fontSize(8.5)
      .font("Helvetica")
      .fillColor(COLOR.textMuted)
      .text(
        `Total Rostered Entries: ${analytics.totalRostered} | Effective Rate: ${analytics.effectiveAttendanceRate.toFixed(1)}% | Operational Availability: ${analytics.operationalAvailabilityRate.toFixed(1)}%`,
      );
    doc.moveDown(0.5);

    // Attendance Distribution Horizontal Segmented Chart
    const chartY = doc.y;
    doc
      .fontSize(8)
      .font("Helvetica-Bold")
      .fillColor(COLOR.textDark)
      .text("ATTENDANCE STATUS DISTRIBUTION", doc.page.margins.left, chartY);

    const barY = chartY + 12;
    const barHeight = 16;
    let currX = doc.page.margins.left;

    const segments = [
      {
        status: "PRESENT" as AttendanceStatus,
        count: analytics.statusDistribution.PRESENT?.count ?? 0,
        color: COLOR.statusPresent,
        label: "Present",
      },
      {
        status: "LATE" as AttendanceStatus,
        count: analytics.statusDistribution.LATE?.count ?? 0,
        color: COLOR.statusLate,
        label: "Late",
      },
      {
        status: "ABSENT" as AttendanceStatus,
        count: analytics.statusDistribution.ABSENT?.count ?? 0,
        color: COLOR.statusAbsent,
        label: "Absent",
      },
      {
        status: "OFF_DUTY" as AttendanceStatus,
        count: analytics.statusDistribution.OFF_DUTY?.count ?? 0,
        color: "#64748b",
        label: "Off Duty",
      },
      {
        status: "LEAVE" as AttendanceStatus,
        count: analytics.statusDistribution.LEAVE?.count ?? 0,
        color: "#2563eb",
        label: "Leave",
      },
      {
        status: "SICK_OFF" as AttendanceStatus,
        count: analytics.statusDistribution.SICK_OFF?.count ?? 0,
        color: "#7c3aed",
        label: "Sick Off",
      },
      {
        status: "OFFICIAL_DUTY" as AttendanceStatus,
        count: analytics.statusDistribution.OFFICIAL_DUTY?.count ?? 0,
        color: "#0d9488",
        label: "Official Duty",
      },
    ];

    const totalCount = analytics.totalRostered || 1;

    // Draw segmented horizontal bar
    doc.rect(doc.page.margins.left, barY, contentWidth, barHeight).stroke(COLOR.border);

    segments.forEach((seg) => {
      const segWidth = (seg.count / totalCount) * contentWidth;
      if (segWidth > 0.5) {
        doc.rect(currX, barY, segWidth, barHeight).fill(seg.color);
        currX += segWidth;
      }
    });

    // Legend underneath
    const legendY = barY + barHeight + 6;
    let legendX = doc.page.margins.left;
    segments.forEach((seg) => {
      if (seg.count > 0 || seg.status === "PRESENT" || seg.status === "ABSENT") {
        doc.rect(legendX, legendY + 1, 8, 8).fill(seg.color);
        const pct = ((seg.count / totalCount) * 100).toFixed(0);
        doc
          .fontSize(7.5)
          .font("Helvetica")
          .fillColor(COLOR.textDark)
          .text(`${seg.label}: ${seg.count} (${pct}%)`, legendX + 11, legendY);
        legendX += 78;
      }
    });

    doc.y = legendY + 18;

    // Daily Attendance Trend Bar Chart (if > 1 day or multi-session)
    if (analytics.dailyTrend.length > 0) {
      ensureSpace(85);
      const trendY = doc.y;
      doc
        .fontSize(8)
        .font("Helvetica-Bold")
        .fillColor(COLOR.textDark)
        .text("DAILY ATTENDANCE TIMELINE", doc.page.margins.left, trendY);

      const chartAreaY = trendY + 12;
      const chartAreaHeight = 45;
      const daysCount = analytics.dailyTrend.length;
      const barSlotWidth = Math.min(60, (contentWidth - 40) / Math.max(daysCount, 1));
      const maxDaily = Math.max(...analytics.dailyTrend.map((d) => d.total), 1);

      // Baseline
      doc
        .moveTo(doc.page.margins.left, chartAreaY + chartAreaHeight)
        .lineTo(doc.page.margins.left + contentWidth, chartAreaY + chartAreaHeight)
        .stroke(COLOR.border);

      analytics.dailyTrend.forEach((item, idx) => {
        const slotX = doc.page.margins.left + 20 + idx * barSlotWidth;
        const totalHeight = (item.total / maxDaily) * (chartAreaHeight - 10);
        const presentHeight = (item.present / maxDaily) * (chartAreaHeight - 10);
        const lateHeight = (item.late / maxDaily) * (chartAreaHeight - 10);

        const barWidth = Math.min(24, barSlotWidth - 6);
        const barBottom = chartAreaY + chartAreaHeight;

        // Present bar segment
        if (presentHeight > 0) {
          doc.rect(slotX, barBottom - presentHeight, barWidth, presentHeight).fill(COLOR.statusPresent);
        }
        // Late bar segment
        if (lateHeight > 0) {
          doc
            .rect(slotX, barBottom - presentHeight - lateHeight, barWidth, lateHeight)
            .fill(COLOR.statusLate);
        }

        // Date label
        doc
          .fontSize(6.5)
          .font("Helvetica")
          .fillColor(COLOR.textMuted)
          .text(item.date.slice(5), slotX - 4, barBottom + 3, {
            width: barWidth + 8,
            align: "center",
          });

        // Value callout
        doc
          .fontSize(6.5)
          .font("Helvetica-Bold")
          .fillColor(COLOR.textDark)
          .text(`${item.present + item.late}`, slotX - 4, barBottom - totalHeight - 9, {
            width: barWidth + 8,
            align: "center",
          });
      });

      doc.y = chartAreaY + chartAreaHeight + 20;
    }
  }

  renderAttendanceAnalytics();

  // -------------------------------------------------------------------------
  // 4. Complete Attendance Register
  // -------------------------------------------------------------------------
  function renderAttendanceRegister() {
    // For daily reports or whenever attendance sessions are present, render complete register
    const hasRoster = snapshot.days.some((d) => d.wards.some((w) => w.roster.length > 0));
    if (!hasRoster) return;

    ensureSpace(100);
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .fillColor(COLOR.primaryDark)
      .text("3. COMPLETE ATTENDANCE REGISTER");
    doc.moveDown(0.3);

    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor(COLOR.textMuted)
      .text(
        "Official verified daily roster frozen into report snapshot. Sourced directly from immutable records.",
      );
    doc.moveDown(0.4);

    const columns = [
      { title: "Emp No", width: 55 },
      { title: "Staff Full Name", width: 105 },
      { title: "Designation", width: 85 },
      { title: "Status", width: 60 },
      { title: "Ward", width: 65 },
      { title: "Date", width: 55 },
      { title: "Session / Details", width: 90 },
    ];

    function drawTableHeader(y: number) {
      doc.rect(doc.page.margins.left, y, contentWidth, 14).fill(COLOR.bgSubtle);
      doc.rect(doc.page.margins.left, y, contentWidth, 14).stroke(COLOR.border);

      let x = doc.page.margins.left + 3;
      columns.forEach((col) => {
        doc
          .fontSize(7)
          .font("Helvetica-Bold")
          .fillColor(COLOR.textDark)
          .text(col.title, x, y + 3, { width: col.width - 6 });
        x += col.width;
      });
    }

    let tableY = doc.y;
    drawTableHeader(tableY);
    tableY += 14;

    for (const day of snapshot.days) {
      for (const ward of day.wards) {
        for (const row of ward.roster) {
          const rowHeight = 14;
          if (tableY + rowHeight > bottomThreshold) {
            doc.addPage();
            renderHeader();
            doc
              .fontSize(9)
              .font("Helvetica-Bold")
              .fillColor(COLOR.primaryDark)
              .text("3. ATTENDANCE REGISTER (CONTINUED)");
            doc.moveDown(0.3);
            tableY = doc.y;
            drawTableHeader(tableY);
            tableY += 14;
          }

          // Row alternate background
          doc.rect(doc.page.margins.left, tableY, contentWidth, rowHeight).stroke(COLOR.borderLight);

          let x = doc.page.margins.left + 3;

          // Emp No
          doc
            .fontSize(7)
            .font("Helvetica-Bold")
            .fillColor(COLOR.textDark)
            .text(row.employeeNumber, x, tableY + 3, { width: columns[0].width - 6 });
          x += columns[0].width;

          // Name
          doc
            .font("Helvetica")
            .fillColor(COLOR.textDark)
            .text(row.fullName, x, tableY + 3, { width: columns[1].width - 6, lineBreak: false });
          x += columns[1].width;

          // Designation
          const desig = row.designation || row.role || "Green Army Staff";
          doc
            .fillColor(COLOR.textMuted)
            .text(desig, x, tableY + 3, { width: columns[2].width - 6, lineBreak: false });
          x += columns[2].width;

          // Status Badge text
          const stColor =
            row.status === "PRESENT"
              ? COLOR.statusPresent
              : row.status === "LATE"
                ? COLOR.statusLate
                : row.status === "ABSENT"
                  ? COLOR.statusAbsent
                  : COLOR.statusExcused;
          doc
            .font("Helvetica-Bold")
            .fillColor(stColor)
            .text(row.status, x, tableY + 3, { width: columns[3].width - 6 });
          x += columns[3].width;

          // Ward
          doc
            .font("Helvetica")
            .fillColor(COLOR.textDark)
            .text(ward.wardName, x, tableY + 3, { width: columns[4].width - 6, lineBreak: false });
          x += columns[4].width;

          // Date
          doc
            .fillColor(COLOR.textMuted)
            .text(day.date, x, tableY + 3, { width: columns[5].width - 6 });
          x += columns[5].width;

          // Detail / Session
          const sessionDetail = row.detail || ward.activity || ward.location || "—";
          doc
            .fillColor(COLOR.textDark)
            .text(sessionDetail, x, tableY + 3, { width: columns[6].width - 6, lineBreak: false });

          tableY += rowHeight;
        }
      }
    }

    doc.y = tableY + 12;
  }

  renderAttendanceRegister();

  // -------------------------------------------------------------------------
  // 5. Work Operations & Narrative Cards
  // -------------------------------------------------------------------------
  function renderWorkOperations() {
    ensureSpace(120);
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .fillColor(COLOR.primaryDark)
      .text("4. OPERATIONAL WORK LOGS & COMPLETE FIELD NARRATIVES");
    doc.moveDown(0.3);

    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor(COLOR.textMuted)
      .text("Every submitted and finalized operational log with complete field narrative and operational facts.");
    doc.moveDown(0.4);

    if (snapshot.workLogs.length === 0) {
      doc
        .fontSize(8.5)
        .font("Helvetica-Oblique")
        .fillColor(COLOR.textMuted)
        .text("No operational work logs submitted or approved for this reporting period.");
      doc.moveDown(1);
      return;
    }

    for (let i = 0; i < snapshot.workLogs.length; i++) {
      const log = snapshot.workLogs[i];
      const cardHeight = 85;

      ensureSpace(cardHeight + 10);
      const cardY = doc.y;

      doc
        .rect(doc.page.margins.left, cardY, contentWidth, cardHeight)
        .fillAndStroke(COLOR.bgLight, COLOR.border);

      // Card Header Ribbon
      doc
        .rect(doc.page.margins.left, cardY, contentWidth, 16)
        .fill(COLOR.bgSubtle);
      doc.rect(doc.page.margins.left, cardY, contentWidth, 16).stroke(COLOR.border);

      doc
        .fontSize(8)
        .font("Helvetica-Bold")
        .fillColor(COLOR.primaryDark)
        .text(
          `#${i + 1} · ${log.activity.toUpperCase()} — ${log.wardName} (${log.date})`,
          doc.page.margins.left + 6,
          cardY + 4,
        );

      const statusBadge =
        log.completionStatus === "COMPLETE" ? "COMPLETE" : "INCOMPLETE";
      const statusColor =
        log.completionStatus === "COMPLETE" ? COLOR.statusPresent : COLOR.statusAbsent;
      doc
        .fontSize(7.5)
        .font("Helvetica-Bold")
        .fillColor(statusColor)
        .text(statusBadge, doc.page.margins.left + contentWidth - 70, cardY + 4, {
          width: 65,
          align: "right",
        });

      // Operational Facts line
      let infoY = cardY + 20;
      doc
        .fontSize(7.5)
        .font("Helvetica-Bold")
        .fillColor(COLOR.textDark)
        .text("Location / Roads: ", doc.page.margins.left + 6, infoY, { continued: true });
      doc
        .font("Helvetica")
        .fillColor(COLOR.textMuted)
        .text(`${log.location} (${log.areasRoads})`, { continued: true });

      doc
        .font("Helvetica-Bold")
        .fillColor(COLOR.textDark)
        .text("  |  Staff Allocations: ", { continued: true });
      doc
        .font("Helvetica")
        .fillColor(COLOR.textMuted)
        .text(`${log.staffCount}`, { continued: true });

      doc
        .font("Helvetica-Bold")
        .fillColor(COLOR.textDark)
        .text("  |  Trips: ", { continued: true });
      doc
        .font("Helvetica")
        .fillColor(COLOR.textMuted)
        .text(`${log.numberOfTrips}`);

      // Narrative Description
      infoY += 12;
      doc
        .fontSize(7.5)
        .font("Helvetica-Bold")
        .fillColor(COLOR.textDark)
        .text("Operational Narrative: ", doc.page.margins.left + 6, infoY, { continued: true });
      doc
        .font("Helvetica")
        .fillColor(COLOR.textDark)
        .text(log.description || "No narrative supplied.", { width: contentWidth - 12 });

      // Technical & Equipment details
      infoY += 18;
      const equipParts: string[] = [];
      if (log.wasteTransferInvolved) equipParts.push("Waste transfer involved");
      if (log.truckId) equipParts.push(`Truck: ${log.truckId}`);
      if (log.backhoeId) equipParts.push(`Backhoe: ${log.backhoeId}`);
      if (log.cleanupDone) equipParts.push("Cleanup conducted");
      if (log.climateTeamCount > 0) equipParts.push(`Climate Team: ${log.climateTeamCount}`);

      doc
        .fontSize(7)
        .font("Helvetica-Bold")
        .fillColor(COLOR.textMuted)
        .text("Logistics / Equipment: ", doc.page.margins.left + 6, infoY, { continued: true });
      doc
        .font("Helvetica")
        .fillColor(COLOR.textMuted)
        .text(equipParts.length > 0 ? equipParts.join(" · ") : "Standard ward equipment", {
          width: contentWidth - 12,
        });

      // Challenges & Suggested Solutions
      infoY += 12;
      const challengeText = log.challenges ? `Challenges: ${log.challenges}` : "Challenges: None recorded";
      const solutionText = log.suggestedSolutions
        ? ` | Suggested Solutions: ${log.suggestedSolutions}`
        : "";
      const outstandingText = log.outstandingWork
        ? ` | Outstanding Work: ${log.outstandingWork}`
        : "";

      doc
        .fontSize(7)
        .font("Helvetica-Bold")
        .fillColor(COLOR.accentGold)
        .text(`${challengeText}${solutionText}${outstandingText}`, doc.page.margins.left + 6, infoY, {
          width: contentWidth - 12,
        });

      doc.y = cardY + cardHeight + 8;
    }
  }

  renderWorkOperations();

  // -------------------------------------------------------------------------
  // 6. Constituent Comparisons (Subcounty / County scopes)
  // -------------------------------------------------------------------------
  function renderConstituentComparisons() {
    const comparisons = snapshot.analytics.constituentComparisons;
    if (!comparisons || comparisons.length <= 1) return;

    ensureSpace(120);
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .fillColor(COLOR.primaryDark)
      .text("5. CONSTITUENT AREA COMPARATIVE ANALYSIS");
    doc.moveDown(0.3);

    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor(COLOR.textMuted)
      .text("Cross-jurisdictional performance comparison across constituent reporting units.");
    doc.moveDown(0.4);

    const tableY = doc.y;
    doc.rect(doc.page.margins.left, tableY, contentWidth, 14).fill(COLOR.bgSubtle);
    doc.rect(doc.page.margins.left, tableY, contentWidth, 14).stroke(COLOR.border);

    const cols = [
      { title: "Constituent Unit", width: 140 },
      { title: "Attendance Rate", width: 95 },
      { title: "Work Operations", width: 95 },
      { title: "Total Trips", width: 90 },
      { title: "Completion Rate", width: 95 },
    ];

    let x = doc.page.margins.left + 4;
    cols.forEach((c) => {
      doc
        .fontSize(7)
        .font("Helvetica-Bold")
        .fillColor(COLOR.textDark)
        .text(c.title, x, tableY + 3, { width: c.width - 8 });
      x += c.width;
    });

    let rowY = tableY + 14;
    comparisons.forEach((comp) => {
      if (rowY + 14 > bottomThreshold) {
        doc.addPage();
        rowY = doc.page.margins.top;
      }
      doc.rect(doc.page.margins.left, rowY, contentWidth, 14).stroke(COLOR.borderLight);

      let rx = doc.page.margins.left + 4;
      doc
        .fontSize(7)
        .font("Helvetica-Bold")
        .fillColor(COLOR.textDark)
        .text(comp.name, rx, rowY + 3, { width: cols[0].width - 8 });
      rx += cols[0].width;

      doc
        .font("Helvetica")
        .fillColor(COLOR.primary)
        .text(`${comp.attendanceRate.toFixed(1)}%`, rx, rowY + 3, { width: cols[1].width - 8 });
      rx += cols[1].width;

      doc
        .fillColor(COLOR.textDark)
        .text(`${comp.workLogsCount}`, rx, rowY + 3, { width: cols[2].width - 8 });
      rx += cols[2].width;

      doc
        .fillColor(COLOR.textDark)
        .text(`${comp.tripsCount}`, rx, rowY + 3, { width: cols[3].width - 8 });
      rx += cols[3].width;

      doc
        .fillColor(COLOR.primaryDark)
        .text(`${comp.completionRate.toFixed(1)}%`, rx, rowY + 3, { width: cols[4].width - 8 });

      rowY += 14;
    });

    doc.y = rowY + 12;
  }

  renderConstituentComparisons();

  // -------------------------------------------------------------------------
  // 7. Recommendations
  // -------------------------------------------------------------------------
  function renderRecommendations() {
    ensureSpace(65);
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .fillColor(COLOR.primaryDark)
      .text("6. STRATEGIC RECOMMENDATIONS & OPERATIONAL FOLLOW-UP");
    doc.moveDown(0.3);

    const boxY = doc.y;
    doc
      .rect(doc.page.margins.left, boxY, contentWidth, 36)
      .fillAndStroke(COLOR.accentGoldLight, COLOR.accentGold);

    doc
      .fontSize(8)
      .font("Helvetica-Bold")
      .fillColor(COLOR.accentGold)
      .text(
        snapshot.recommendations ||
          "Sustain completed activities, prioritize incomplete works, and address emerging field challenges promptly.",
        doc.page.margins.left + 8,
        boxY + 7,
        { width: contentWidth - 16, lineGap: 2 },
      );

    doc.y = boxY + 45;
  }

  renderRecommendations();

  // -------------------------------------------------------------------------
  // 8. Photographic Evidence & Evidence Appendix
  // -------------------------------------------------------------------------
  async function renderEvidenceSection() {
    const isDaily = snapshot.kind === "DAILY";
    // Deduplicated canonical evidence list
    const evidenceList = snapshot.evidence && snapshot.evidence.length > 0
      ? snapshot.evidence
      : snapshot.workLogs.flatMap((w) => w.photos);

    if (evidenceList.length === 0) return;

    ensureSpace(120);
    doc
      .fontSize(11)
      .font("Helvetica-Bold")
      .fillColor(COLOR.primaryDark)
      .text(isDaily ? "7. PHOTOGRAPHIC EVIDENCE (ALL STAGES)" : "7. EVIDENCE APPENDIX & FIELD ARCHIVE");
    doc.moveDown(0.3);

    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor(COLOR.textMuted)
      .text(
        isDaily
          ? "Complete Before, During and After photographic register verifying field operations."
          : "Full archived evidence appendix containing all in-scope operational photographs.",
      );
    doc.moveDown(0.5);

    // 2 images per row
    const photoWidth = (contentWidth - 12) / 2;
    const photoHeight = 110;
    const blockHeight = photoHeight + 35;

    for (let i = 0; i < evidenceList.length; i += 2) {
      ensureSpace(blockHeight);
      const rowY = doc.y;

      const batch = [evidenceList[i], evidenceList[i + 1]].filter(Boolean) as ReportPhotoRef[];

      for (let c = 0; c < batch.length; c++) {
        const photo = batch[c];
        const photoX = doc.page.margins.left + c * (photoWidth + 12);

        // Frame
        doc
          .rect(photoX, rowY, photoWidth, blockHeight - 5)
          .fillAndStroke(COLOR.bgLight, COLOR.border);

        let imageLoaded = false;
        if (options.imageLoader && photo.objectKey) {
          try {
            const rawBytes = await options.imageLoader(photo.objectKey);
            if (rawBytes) {
              const opt = await optimizeImage(rawBytes);
              if (opt) {
                doc.image(opt, photoX + 2, rowY + 2, {
                  width: photoWidth - 4,
                  height: photoHeight - 4,
                  fit: [photoWidth - 4, photoHeight - 4],
                  align: "center",
                  valign: "center",
                });
                imageLoaded = true;
              }
            }
          } catch {
            imageLoaded = false;
          }
        }

        if (!imageLoaded) {
          // Placeholder box
          doc
            .rect(photoX + 2, rowY + 2, photoWidth - 4, photoHeight - 4)
            .fill(COLOR.bgSubtle);
          doc
            .fontSize(7.5)
            .font("Helvetica-Bold")
            .fillColor(COLOR.textMuted)
            .text("Archived Photo Asset", photoX + 10, rowY + (photoHeight / 2) - 10, {
              width: photoWidth - 20,
              align: "center",
            });
          doc
            .fontSize(6)
            .font("Helvetica")
            .fillColor(COLOR.textLight)
            .text(`SHA-256: ${photo.sha256.slice(0, 16)}...`, photoX + 10, rowY + (photoHeight / 2) + 2, {
              width: photoWidth - 20,
              align: "center",
            });
        }

        // Caption and meta below image
        const metaY = rowY + photoHeight + 3;
        doc
          .fontSize(7)
          .font("Helvetica-Bold")
          .fillColor(COLOR.primaryDark)
          .text(`[${photo.stage}] ${photo.caption || "Operational evidence"}`, photoX + 4, metaY, {
            width: photoWidth - 8,
            lineBreak: false,
          });

        const subText = `${photo.wardName || snapshot.scopeName} · ${photo.activity || "Operations"} · ${photo.date || snapshot.startDate}`;
        doc
          .fontSize(6.5)
          .font("Helvetica")
          .fillColor(COLOR.textMuted)
          .text(subText, photoX + 4, metaY + 11, {
            width: photoWidth - 8,
            lineBreak: false,
          });
      }

      doc.y = rowY + blockHeight;
    }
  }

  await renderEvidenceSection();

  // -------------------------------------------------------------------------
  // 9. Final Sign-off & Document Integrity Footer (Across all pages)
  // -------------------------------------------------------------------------
  const snapshotSha256 = snapshot.snapshotSha256 || canonicalSnapshotHash(snapshot);
  const range = doc.bufferedPageRange();
  const totalPages = range.count;

  for (let p = 0; p < totalPages; p++) {
    doc.switchToPage(p);
    const footerY = doc.page.height - 35;

    doc
      .moveTo(doc.page.margins.left, footerY - 4)
      .lineTo(doc.page.margins.left + contentWidth, footerY - 4)
      .stroke(COLOR.border);

    // Left: Authorized / signed info
    const signer = snapshot.signedBy
      ? `Authorized by: ${snapshot.signedBy} (${snapshot.signedTitle || "Authorized Officer"})`
      : "Official System Archive";

    doc
      .fontSize(6.5)
      .font("Helvetica-Bold")
      .fillColor(COLOR.textDark)
      .text(signer, doc.page.margins.left, footerY, { width: 280, lineBreak: false });

    // Middle/Hash: Snapshot integrity hash
    doc
      .fontSize(6)
      .font("Helvetica")
      .fillColor(COLOR.textMuted)
      .text(
        `Snapshot Hash: ${snapshotSha256.slice(0, 24)}... | Renderer v${RENDERER_VERSION}`,
        doc.page.margins.left,
        footerY + 9,
        { width: 350, lineBreak: false },
      );

    // Right: Page numbers
    doc
      .fontSize(7)
      .font("Helvetica-Bold")
      .fillColor(COLOR.primaryDark)
      .text(`Page ${p + 1} of ${totalPages}`, doc.page.margins.left + contentWidth - 80, footerY + 2, {
        width: 80,
        align: "right",
      });
  }

  doc.end();

  return await new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}
