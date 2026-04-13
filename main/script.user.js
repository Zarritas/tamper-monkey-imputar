// ==UserScript==
// @name         Imputaciones con OdooRPC - Popup
// @namespace    http://tampermonkey.net/
// @version      2.2.6
// @description  Create timesheet entries directly from GitLab using OdooRPC popup posibilidad de generar la descripción por IA
// @author       Jesús Lorenzo
// @match        https://git.*
// @include      */issues/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=factorlibre.com
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @resource ai_prompt https://raw.githubusercontent.com/Zarritas/tamper-monkey-imputar/refs/heads/main/main/prompts/prompt-ia.txt
// @resource css https://raw.githubusercontent.com/Zarritas/tamper-monkey-imputar/refs/heads/main/main/css/style.css
// @resource popup https://raw.githubusercontent.com/Zarritas/tamper-monkey-imputar/refs/heads/main/main/html/popup.html
// @resource config-popup https://raw.githubusercontent.com/Zarritas/tamper-monkey-imputar/refs/heads/main/main/html/config-popup.html
// @require      https://raw.githubusercontent.com/Zarritas/tamper-monkey-imputar/refs/heads/main/main/scripts/utils.js
// @require      https://raw.githubusercontent.com/Zarritas/tampermonkey-odoo-rpc/refs/heads/main/OdooRPC.js
// @connect      *
// @updateURL    https://github.com/Zarritas/tamper-monkey-imputar/raw/refs/heads/main/main/script.user.js
// @downloadURL  https://github.com/Zarritas/tamper-monkey-imputar/raw/refs/heads/main/main/script.user.js
// ==/UserScript==

(function () {
  "use strict";
  let odooRPC = null;
  const link = document.createElement("link");
  let CONFIG = {
    GITLAB_DOMAIN: "git.tuempresa.com",
    LANG: "es_ES",
    TIMEZONE: "Europe/Madrid",
  };
  let timeStart = null
  let timeEnd = null
  let totalTime = null
  let description = null
  let date = null

  GM_addStyle(GM_getResourceText("css"));
  setGlobalConfig()

  document.head.appendChild(link);
  
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap";
  
  window.addEventListener("load", function () {
    const sidebar = document.querySelector(
      '.issuable-sidebar-header div[data-testid="sidebar-todo"]'
    );
    if (sidebar) {
      const button = document.createElement("button");
      button.classList.add(
        "btn",
        "hide-collapsed",
        "btn-default",
        "btn-sm",
        "gl-button"
      );
      const span = document.createElement("span");
      span.innerText = "⏱️ Imputar Horas";
      button.appendChild(span);
      button.addEventListener("click", showTimesheetPopup);
      sidebar.appendChild(button);
    }
  });

  async function enviarImputacion(issueInfo) {
    const active = document.querySelectorAll("div.active");
    let description = document.getElementById("timesheet-description");
    let date = document.getElementById("timesheet-date");
    let hours;
    if (active[1].id == "form-total") {
      description = description.value.trim();
      date = date.value;
      const timeInput = document.getElementById("timesheet-hours").value.trim();

      if (!description) {
        showStatus("Por favor, introduce una descripción", "error");
        return;
      }
      if (!timeInput) {
        showStatus("Por favor, introduce el tiempo trabajado", "error");
        return;
      }
      
      hours = parseTimeToDecimal(timeInput);
      
      if (hours === null) {
        showStatus(
          "Formato de tiempo inválido. Usa HH:MM (ej: 2:30) o decimal (ej: 2.5)",
          "error"
        );
        return;
      }
      if (hours <= 0 || hours > 24) {
        showStatus("El tiempo debe estar entre 0 y 24 horas", "error");
        return;
      }
    } else if (active[1].id == "form-inicio_fin") {
      description = description.value.trim();
      date = date.value;
      const timeStartInput = document
        .getElementById("timesheet-start")
        .value.trim();
      const timeEndInput = document
        .getElementById("timesheet-end")
        .value.trim();

      if (!description) {
        showStatus("Por favor, introduce una descripción", "error");
        return;
      }
      if (!timeStartInput) {
        showStatus("Por favor, introduce la hora de Inicio", "error");
        return;
      }
      if (!timeEndInput) {
        showStatus("Por favor, introduce la hora de Fin", "error");
        return;
      }
      
      const startHours = parseTimeToDecimal(timeStartInput);
      const endHours = parseTimeToDecimal(timeEndInput);
      
      if (startHours === null || endHours === null) {
        showStatus(
          "Formato de tiempo inválido. Usa HH:MM (ej: 12:30)",
          "error"
        );
        return;
      }
      if (startHours <= 0 || startHours > 24) {
        showStatus("El tiempo debe estar entre 0 y 24 horas", "error");
        return;
      }
      if (endHours <= 0 || endHours > 24) {
        showStatus("El tiempo debe estar entre 0 y 24 horas", "error");
        return;
      }
      
      hours = endHours - startHours;
      
      if (hours <= 0) {
        showStatus(
          "La hora de fin debe ser siempre superior a la hora de inicio",
          "error"
        );
        return;
      }
    }
    await createTimesheetEntry(issueInfo, description, hours, date);
  }

  async function showTimesheetPopup() {
    const issueInfo = getIssueInfo();
    const overlay = document.createElement("div");
    const popup = document.createElement("div");

    overlay.className = "timesheet-overlay";
    popup.className = "timesheet-popup";
    popup.innerHTML = interpolate(
      GM_getResourceText("popup"),
      {
        project: issueInfo.proyecto.split("/")[issueInfo.proyecto.split("/").length - 1],
        issue: issueInfo.tarea.split("/")[issueInfo.tarea.split("/").length - 1],
        title: issueInfo.titulo,
        description: description || "",
        total_time: totalTime || "",
        start_time: timeStart || "",
        end_time: timeEnd || "",
        date: new Date().toISOString().split("T")[0],
      }
    );
    document.body.appendChild(overlay);
    document.body.appendChild(popup);


    if (CONFIG.ODOO_URL == "" || CONFIG.DB_NAME == "") {
      showConfigMenu();
    }
    const configButton = document.getElementById("setup-config");
    const iaButton = document.getElementById("ia-button");
    const descriptionField = document.getElementById("timesheet-description");
    const hoursField = document.getElementById("timesheet-hours");
    const hourStart = document.getElementById("timesheet-start")
    const hourEnd = document.getElementById("timesheet-end")
    const dateField = document.getElementById("timesheet-date")
    const dedicateTab = document.getElementById("dedicate-tab");
    const startEndTab = document.getElementById("start_end-tab");
    const formTotal = document.getElementById("form-total");
    const formInicioFin = document.getElementById("form-inicio_fin");
    const cancelButton = document.getElementById("timesheet-cancel")
    const submitButton = document.getElementById("timesheet-submit")
    const odooRedirect = document.getElementById("timesheet-odoo")

    descriptionField.focus();

    configButton.addEventListener("click", showConfigMenu);
    hoursField.addEventListener("input", checkFormat);
    hourStart.addEventListener("input", checkFormat);
    hourEnd.addEventListener("input", checkFormat);
    overlay.addEventListener("click", closeTimesheetPopup);
    cancelButton.addEventListener("click", closeTimesheetPopup);

    submitButton.addEventListener("click", await function() {
      enviarImputacion(issueInfo)
    });
    iaButton.addEventListener("click", async function () {
      if (!CONFIG.API_KEY || CONFIG.API_KEY === "") {
        showConfigMenu();
        showStatus(
          "Configurar api_key",
          "error",
          document.getElementById("config-status")
        );
        return;
      }
      await generateIADescription(
        CONFIG.API_KEY,
        descriptionField,
        this,
        document.getElementById("config-status"),
        {
          day: dateField.value,
          comments: document.getElementById("notes-list").textContent,
          user: document.getElementById("disclosure-6").getElementsByClassName("gl-font-bold")[0].textContent
        }
      );
    });
    
    descriptionField.addEventListener("change", e => description = e.target.value);
    hoursField.addEventListener("change", e => totalTime = e.target.value);
    hourStart.addEventListener("change", e => timeStart = e.target.value);
    hourEnd.addEventListener("change", e => timeEnd = e.target.value);
    dateField.addEventListener("change", e => date = e.target.value);
    
    dedicateTab.addEventListener("click", () => {
      switchTab(dedicateTab, startEndTab, formTotal, formInicioFin);
    });
    startEndTab.addEventListener("click", () => {
      switchTab(startEndTab, dedicateTab, formInicioFin, formTotal);
    });
    odooRedirect.addEventListener("click", () => {
      window.open(
        `${CONFIG.ODOO_URL}/web#view_type=list&model=account.analytic.line&action=976`
      );
    });
    document.addEventListener("keydown", function escHandler(e) {
      if (e.key === "Escape") {
        if (document.getElementById("config-popup")){
            closeConfigPopup()
            return;
        }
        closeTimesheetPopup();
        document.removeEventListener("keydown", escHandler);
      }
    });
  }

  async function createTimesheetEntry(
    issueInfo,
    description,
    hours,
    date,
    datetime
  ) {
    try {
      const authenticated = await odooRPC.authenticate();
      showStatus("🔄 Conectando con Odoo...", "loading");
      if (!authenticated) {
        showStatus(
          "❌ Error de autenticación. ¿Estás logueado en Odoo?",
          "error"
        );
        return;
      }
      showStatus("🔍 Buscando tarea...", "loading");
      const project = await odooRPC.odooSearch("gitlab.project.project", [
        ["project_url", "=", issueInfo.proyecto],
      ]);
      if (!project || project.length === 0) {
        showStatus(
          `❌ No se encontró el projecto ${
            issueInfo.proyecto.split("/")[
              issueInfo.proyecto.split("/").length - 1
            ]
          } o no está sincronizada en odoo`,
          "error"
        );
        return;
      }
      const projectId = project.records[0].odoo_id[0];
      showStatus("🔍 Buscando tarea...", "loading");
      const tasks = await odooRPC.odooSearch("gitlab.project.task", [
        ["gitlab_url", "=", issueInfo.tarea],
      ]);
      if (!tasks || tasks.length === 0) {
        showStatus(
          `⚠️ No se encontró la tarea #${
            issueInfo.tarea.split("/")[issueInfo.tarea.split("/").length - 1]
          }.`,
          "error"
        );
        return;
      }
      const taskId = tasks.records[0].odoo_id[0];
      showStatus("💾 Creando parte de horas...", "loading");
      const timesheetId = await odooRPC.createTimesheetEntry(
        projectId,
        taskId,
        description,
        hours,
        date,
        datetime
      );

      if (timesheetId) {
        showStatus(
          `✅ ¡Parte de horas creado exitosamente! (ID: ${timesheetId})`,
          "success"
        );
        setTimeout(() => {
          closeConfigPopup()
          closeTimesheetPopup();
        }, 3000);
      } else {
        showStatus("❌ Error al crear el parte de horas", "error");
      }
    } catch (error) {
      console.error("Error creando timesheet:", error);
      showStatus(`❌ Error: ${error.message}`, "error");
    }
  }
  
  function closeTimesheetPopup() {
    const overlay = document.querySelector(".timesheet-overlay");
    const popup = document.querySelector(".timesheet-popup");
    if (overlay) overlay.remove();
    if (popup) popup.remove();
  }
  
  function closeConfigPopup() {
    const overlay = document.querySelector(".config-overlay");
    const popup = document.querySelector(".config-popup");
    if (overlay) overlay.remove();
    if (popup) popup.remove();
    document.getElementById("setup-config").addEventListener("click",showConfigMenu)
  }

  function saveConfig() {
    const newUrl = document.getElementById("timesheet-url").value;
    if (newUrl !== null && newUrl.trim() !== "") {
      GM_setValue("odoo_url", newUrl.replace(/\/$/, ""));
    }

    const newDb = document.getElementById("timesheet-db").value;
    if (newDb !== null && newDb.trim() !== "") {
      GM_setValue("db_name", newDb);
    }

    const newApiKey = document.getElementById("timesheet-api-key").value;
    if (newApiKey !== null && newApiKey.trim() !== "") {
      GM_setValue("api_key", newApiKey);
    }
    showStatus(
      "Configuración actualizada.",
      "success",
      document.getElementById("config-status")
    );
    setGlobalConfig()
    setTimeout(closeConfigPopup, 1000);
  }

  function showConfigMenu() {
    const currentUrl = CONFIG.ODOO_URL || "";
    const currentDb = CONFIG.DB_NAME || "";
    const currentApiKey = CONFIG.API_KEY || "";
    const overlay = document.createElement("div");
    const popup = document.createElement("div");

    overlay.className = "timesheet-overlay config-overlay";
    popup.className = "timesheet-popup config-popup";
    popup.id = "config-popup";
    popup.innerHTML = interpolate(
      GM_getResourceText("config-popup"),
      {
        currentUrl,
        currentDb,
        currentApiKey
      }
    );

    document.body.appendChild(overlay);
    document.body.appendChild(popup);
    
    overlay.addEventListener("click", closeConfigPopup)

    document
      .getElementById("config-submit")
      .addEventListener("click", saveConfig);
    document
      .getElementById("config-cancel")
      .addEventListener("click", closeConfigPopup);
    document.getElementById('setup-config').removeEventListener("click",showConfigMenu)
  }

  function setGlobalConfig(){
    CONFIG.ODOO_URL = GM_getValue("odoo_url", CONFIG.ODOO_URL);
    CONFIG.DB_NAME = GM_getValue("db_name", CONFIG.DB_NAME);
    CONFIG.API_KEY = GM_getValue("api_key", CONFIG.API_KEY);
    odooRPC = new OdooRPC(
      CONFIG.ODOO_URL,
      CONFIG.DB,
      {
        lang: CONFIG.LANG,
        tz: CONFIG.TIMEZONE,
      },
    );
  }

  function getIssueInfo() {
    let proyecto = `${document.location.origin}${document
      .querySelector('div[data-testid="nav-item-link-label"')
      .parentElement.getAttribute("href")}`;
    const tarea = window.location.href.split("#")[0];

    const titleElement =
      document.querySelector('h1[data-testid="issue-title-text"]') ||
      document.querySelector(".issue-title-text") ||
      document.querySelector("h1.title");
    const titulo = titleElement
      ? titleElement.textContent.trim()
      : `Issue #${tarea.split("/")[tarea.split("/").length - 1]}`;
    return { proyecto, tarea, titulo };
  }
})();
