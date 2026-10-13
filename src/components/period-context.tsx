"use client";
import { createContext, useContext } from "react";
import { words, type PeriodKind } from "@/lib/period";

/** Whether the report on screen is monthly or weekly, for wording ("vs last week"). */
export const PeriodContext = createContext<PeriodKind>("month");
export const usePeriod = () => useContext(PeriodContext);
export const useWords = () => words(useContext(PeriodContext));
