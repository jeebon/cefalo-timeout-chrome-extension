const environment = "development";

function logger() {
  if (environment === "development") {
    console.log(...arguments);
  }
}

function getSafeLeaveTime(entryTime, minHours, minMinutes) {
  var [hours, minutes] = entryTime.split(":");
  hours = parseInt(hours);
  minutes = parseInt(minutes);
  hours += minHours;
  minutes += minMinutes;
  if (minutes >= 60) {
    hours += Math.floor(minutes / 60);
    minutes %= 60;
  }
  hours %= 12;
  var formattedTime = `${hours.toString().padStart(2, "0")}:${minutes
    .toString()
    .padStart(2, "0")}`;
  return formattedTime;
}

function spendTimeTillNow(entryTime, currentTime) {
  var [hours, minutes] = entryTime.split(":");
  hours = parseInt(hours);
  minutes = parseInt(minutes);
  const targetTime = new Date();
  targetTime.setHours(hours, minutes, 0, 0);

  logger(entryTime, currentTime, "::", targetTime, currentTime);

  // Calculate the time difference in milliseconds
  const timeDifferenceMs = currentTime - targetTime;

  const hrs = Math.floor(timeDifferenceMs / (1000 * 60 * 60));
  const mins = Math.floor((timeDifferenceMs % (1000 * 60 * 60)) / (1000 * 60));
  return [hrs, mins];
}

function addExtendedColumnsInAttendenceReport() {
  const tableParent = document.querySelector(".react-bootstrap-table");
  const table = tableParent.querySelector("table");

  const safeLeaveTitle = "Secure End Time";
  const entryTimeColumnNo = 1; // index start from 0
  const insertBeforColumnNo = 3; // index start from 0

  if (table) {
    const headerRow = table.querySelector("thead tr");

    const existingFourthColumn =
      headerRow.children[insertBeforColumnNo].textContent;
    if (existingFourthColumn.trim() === safeLeaveTitle) {
      return;
    }

    const headerColumn = document.createElement("th");
    headerColumn.textContent = safeLeaveTitle;
    headerRow.insertBefore(
      headerColumn,
      headerRow.children[insertBeforColumnNo]
    );

    const dataRows = table.querySelectorAll("tbody tr");

    const currentTime = new Date();

    for (let i = 0; i < dataRows.length; i++) {
      const entryTime = dataRows[i].children[entryTimeColumnNo].textContent;

      let timeCellData = "00:00";

      if (entryTime && entryTime !== "00:00") {
        const safeOutTime = getSafeLeaveTime(entryTime, 9, 0);
        logger("safeOutTime", safeOutTime);
        if (safeOutTime) {
          timeCellData = safeOutTime + " PM";
        }
        if (i == 0) {
          const [spendHours, spendMins] = spendTimeTillNow(
            entryTime,
            currentTime
          );
          timeCellData = `${timeCellData} (Spend: ${spendHours}hours:${spendMins}mins)`;
        }
      }

      const newTimeCell = document.createElement("td");
      newTimeCell.textContent = timeCellData;
      dataRows[i].insertBefore(
        newTimeCell,
        dataRows[i].children[insertBeforColumnNo]
      );
    }
  } else {
    logger("Table not found!");
  }
}

window.addEventListener("load", function () {
  let i = 0;
  const interval = setInterval(function () {
    const tableParent = document.querySelector(".react-bootstrap-table");
    if (tableParent) {
      logger("Table found!");
      clearInterval(interval);
      addExtendedColumnsInAttendenceReport();
    }
    if (i > 10) {
      logger("10 time tried table not found!");
      clearInterval(interval);
    }
    i++;
  }, 1000);
});
