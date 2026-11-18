import { useState } from "react";
import { format, subDays } from "date-fns";
import { AppContext } from "./useAppContext";

export function AppProvider({ children }) {
  const [websiteId, setWebsiteId] = useState(null);
  const [range, setRange] = useState({
    startDate: format(subDays(new Date(), 28), "yyyy-MM-dd"),
    endDate: format(subDays(new Date(), 1), "yyyy-MM-dd"),
  });
  return (
    <AppContext.Provider value={{ websiteId, setWebsiteId, range, setRange }}>
      {children}
    </AppContext.Provider>
  );
}