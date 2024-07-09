const ENV = "development";
const SAFE_DURATION = {
  hours: 8,
  minutes: 30,
};

function logger(...args) {
  if (ENV === "development") {
    console.log(...args);
  }
}

function getSafeLeaveTime(entryTime, minHours, minMinutes) {
  let [hours, minutes] = entryTime.split(":").map(Number);
  hours += minHours;
  minutes += minMinutes;
  if (minutes >= 60) {
    hours += Math.floor(minutes / 60);
    minutes %= 60;
  }
  hours %= 12;
  return `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}`;
}

function spendTimeTillNow(entryTime, currentTime) {
  const [entryHours, entryMinutes] = entryTime.split(":").map(Number);
  const targetTime = new Date();
  targetTime.setHours(entryHours, entryMinutes, 0, 0);

  logger(entryTime, currentTime, "::", targetTime);

  const timeDifferenceMs = currentTime - targetTime;
  const hours = Math.floor(timeDifferenceMs / (1000 * 60 * 60));
  const minutes = Math.floor(
    (timeDifferenceMs % (1000 * 60 * 60)) / (1000 * 60)
  );
  return [hours, minutes];
}

function addExtendedColumnsInAttendanceReport() {
  const tableParent = document.querySelector(".react-bootstrap-table");
  const table = tableParent?.querySelector("table");

  const safeLeaveTitle = "Secure End Time";
  const entryTimeColumnNo = 1;
  const insertBeforeColumnNo = 3;

  if (table) {
    const headerRow = table.querySelector("thead tr");

    if (
      headerRow.children[insertBeforeColumnNo]?.textContent.trim() ===
      safeLeaveTitle
    ) {
      return;
    }

    const headerColumn = document.createElement("th");
    headerColumn.textContent = safeLeaveTitle;
    headerRow.insertBefore(
      headerColumn,
      headerRow.children[insertBeforeColumnNo]
    );

    const dataRows = table.querySelectorAll("tbody tr");
    const currentTime = new Date();

    dataRows.forEach((row, index) => {
      const entryTime = row.children[entryTimeColumnNo].textContent.trim();

      let timeCellData = "00:00";
      if (entryTime && entryTime !== "00:00") {
        const safeOutTime = getSafeLeaveTime(
          entryTime,
          SAFE_DURATION.hours,
          SAFE_DURATION.minutes
        );
        logger("safeOutTime", safeOutTime);

        if (safeOutTime) {
          timeCellData = `${safeOutTime} PM`;
        }

        if (index === 0) {
          const [spendHours, spendMinutes] = spendTimeTillNow(
            entryTime,
            currentTime
          );
          timeCellData += ` (Spend: ${spendHours} hours:${spendMinutes} mins)`;
        }
      }

      const newTimeCell = document.createElement("td");
      newTimeCell.textContent = timeCellData;
      row.insertBefore(newTimeCell, row.children[insertBeforeColumnNo]);
    });
  } else {
    logger("Table not found!");
  }
}

window.addEventListener("load", () => {
  let attempts = 0;
  const maxAttempts = 10;
  const interval = setInterval(() => {
    const tableParent = document.querySelector(".react-bootstrap-table");
    if (tableParent) {
      logger("Table found!");
      clearInterval(interval);
      addExtendedColumnsInAttendanceReport();
    }
    if (attempts >= maxAttempts) {
      logger("Table not found after 10 attempts!");
      clearInterval(interval);
    }
    attempts++;
  }, 1000);
});
