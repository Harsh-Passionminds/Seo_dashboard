import { createContext, useContext } from "react";

export const AppContext = createContext(null);

export const useWebsite = () => {
  const { websiteId, setWebsiteId } = useContext(AppContext);
  return { websiteId, setWebsiteId };
};

export const useDateRange = () => {
  const { range, setRange } = useContext(AppContext);
  return { range, setRange };
};
