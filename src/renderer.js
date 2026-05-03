import { BillbookApp } from "./app/app-controller.js";
import { createJournalGateway } from "./app/journal-gateway.js";

const gateway = createJournalGateway(window.journalApp);
const app = new BillbookApp(gateway);

app.initialize();
