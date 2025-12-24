function onOpen() {
  const s = SpreadsheetApp.getActiveSheet();
  s.setActiveSelection("A" + (s.getLastRow() + 1));
}