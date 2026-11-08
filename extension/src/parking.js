const button = document.querySelector("#restore");
button.addEventListener("click", async () => {
  button.disabled = true;
  try {
    const result = await chrome.runtime.sendMessage({ type: "parking-recover" });
    document.querySelector("#status").textContent = result?.ok
      ? "Tabs have returned to their open windows. Any remaining tabs are still here."
      : "Your tabs are still here. Open them from the tab bar or drag them to another window.";
  } finally {
    button.disabled = false;
  }
});
