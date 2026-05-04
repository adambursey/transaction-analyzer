import React, { useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";
import {
  FileSpreadsheet,
  LogOut,
  RefreshCw,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  DollarSign,
  PieChart as PieChartIcon,
  BarChart3,
  Activity,
  Settings,
  ChevronDown,
  ChevronUp,
  LayoutList,
  List,
  Wallet,
  LayoutDashboard,
  Filter,
  Search,
  ArrowLeft,
  X,
  UploadCloud,
} from "lucide-react";
import { format, parseISO, isValid } from "date-fns";
import { ImportModal } from "./components/ImportModal";
import { ReviewQueue } from "./components/ReviewQueue";
import { ImportHistory } from "./components/ImportHistory";

const CATEGORY_COLORS = [
  "#3377FF",
  "#3355FF",
  "#3333FF",
  "#5533FF",
  "#7733FF",
  "#9933FF",
  "#BB33FF",
  "#DD33FF",
  "#FF33FF",
  "#FF3333",
  "#FF5533",
  "#FF7733",
  "#FF9933",
  "#FFBB33",
  "#FFDD33",
  "#FFFF33",
  "#DDFF33",
  "#55FF33",
  "#33FFFF",
  "#33DDFF",
  "#33BBFF",
  "#3399FF"
];

const categoryColorMap = new Map<string, string>();
let nextColorIndex = 0;

const getCategoryColor = (categoryName: string) => {
  if (!categoryName) return "#cbd5e1";
  
  if (categoryColorMap.has(categoryName)) {
    return categoryColorMap.get(categoryName)!;
  }
  
  const color = CATEGORY_COLORS[nextColorIndex % CATEGORY_COLORS.length];
  categoryColorMap.set(categoryName, color);
  nextColorIndex++;
  
  return color;
};

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<any[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [analysis, setAnalysis] = useState<any>(null);
  const [isTopExpensesExpanded, setIsTopExpensesExpanded] = useState(true);
  const [isCategoryTableExpanded, setIsCategoryTableExpanded] = useState(true);
  const [showTableTotals, setShowTableTotals] = useState(false);
  const [budgetData, setBudgetData] = useState<any[]>([]);
  const [budgetHeaders, setBudgetHeaders] = useState<string[]>([]);
  const [currentView, setCurrentView] = useState<"dashboard" | "transactions" | "budget">("dashboard");
  const [txFilterCategory, setTxFilterCategory] = useState("");
  const [txFilterSubcategory, setTxFilterSubcategory] = useState("");
  const [txFilterType, setTxFilterType] = useState<"all" | "income" | "expense">("all");
  const [showTxTotals, setShowTxTotals] = useState(false);
  const [selectedYear, setSelectedYear] = useState<string>(new Date().getFullYear().toString());
  const [selectedMonth, setSelectedMonth] = useState<string>(format(new Date(), "MMM yyyy"));
  const [availableYears, setAvailableYears] = useState<string[]>([]);
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [isBudgetModalOpen, setIsBudgetModalOpen] = useState(false);
  const [isBudgetExpensesExpanded, setIsBudgetExpensesExpanded] = useState(true);
  const [isBudgetIncomeExpanded, setIsBudgetIncomeExpanded] = useState(true);
  const [showBudgetAverage, setShowBudgetAverage] = useState(false);
  const [editingBudget, setEditingBudget] = useState<{ category: string; actual: number; average: number; unscaledAverage: number; current: number; monthlyBudget: number } | null>(null);
  const [newBudgetValue, setNewBudgetValue] = useState<string>("");
  const [isUpdatingBudget, setIsUpdatingBudget] = useState(false);
  const [isTxModalOpen, setIsTxModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<any>(null);
  const [editTxAmount, setEditTxAmount] = useState("");
  const [editTxCategory, setEditTxCategory] = useState("");
  const [editTxSubcategory, setEditTxSubcategory] = useState("");
  const [isUpdatingTx, setIsUpdatingTx] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);

  useEffect(() => {
    checkAuthStatus();

    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith(".run.app") && !origin.includes("localhost")) {
        return;
      }
      if (event.data?.type === "OAUTH_AUTH_SUCCESS") {
        if (event.data.tokens) {
          localStorage.setItem("google_tokens", JSON.stringify(event.data.tokens));
        }
        checkAuthStatus();
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchSheetData();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (data.length > 0 && headers.length > 0) {
      analyzeData(data, headers);
    }
  }, [selectedYear, selectedMonth, data, headers, budgetData]);

  const checkAuthStatus = async () => {
    try {
      const tokens = localStorage.getItem("google_tokens");
      const headers: Record<string, string> = {};
      if (tokens) {
        headers["Authorization"] = `Bearer ${encodeURIComponent(tokens)}`;
      }

      const res = await fetch("/api/auth/status", { headers });
      const data = await res.json();
      
      if (!data.authenticated) {
        localStorage.removeItem("google_tokens");
      }
      
      setIsAuthenticated(data.authenticated);
    } catch (err) {
      console.error("Failed to check auth status", err);
      setIsAuthenticated(false);
    }
  };

  const handleLogin = async () => {
    try {
      const redirectUri = `${window.location.origin}/auth/callback`;
      const res = await fetch(
        `/api/auth/url?redirectUri=${encodeURIComponent(redirectUri)}`
      );
      if (!res.ok) throw new Error("Failed to get auth URL");
      const { url } = await res.json();

      const authWindow = window.open(
        url,
        "oauth_popup",
        "width=600,height=700"
      );
      if (!authWindow) {
        setError("Please allow popups for this site to connect your account.");
      }
    } catch (err: any) {
      setError(err.message || "Failed to initiate login");
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      localStorage.removeItem("google_tokens");
      setIsAuthenticated(false);
      setData([]);
      setAnalysis(null);
    } catch (err) {
      console.error("Failed to logout", err);
    }
  };

  const fetchSheetData = async () => {
    setLoading(true);
    setError(null);

    try {
      const tokens = localStorage.getItem("google_tokens");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (tokens) {
        headers["Authorization"] = `Bearer ${encodeURIComponent(tokens)}`;
      }

      const res = await fetch("/api/sheet", {
        method: "POST",
        headers,
        body: JSON.stringify({}),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "Failed to fetch data");
      }

      if (result.data && result.data.length > 0) {
        setData(result.data);
        setHeaders(result.headers);
        if (result.budgetData) {
          setBudgetData(result.budgetData);
          setBudgetHeaders(result.budgetHeaders || []);
        }
      } else {
        setError("No data found in the sheet");
      }
    } catch (err: any) {
      setError(err.message || "An error occurred while fetching data");
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateBudget = async () => {
    if (!editingBudget) return;
    
    setIsUpdatingBudget(true);
    try {
      const tokens = localStorage.getItem("google_tokens");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (tokens) {
        headers["Authorization"] = `Bearer ${encodeURIComponent(tokens)}`;
      }

      const amount = parseFloat(newBudgetValue);
      if (isNaN(amount)) {
        alert("Please enter a valid number");
        return;
      }

      const res = await fetch("/api/budget/update", {
        method: "POST",
        headers,
        body: JSON.stringify({
          category: editingBudget.category,
          amount: amount,
        }),
      });

      if (!res.ok) {
        const result = await res.json();
        throw new Error(result.error || "Failed to update budget");
      }

      // Refresh data
      await fetchSheetData();
      setIsBudgetModalOpen(false);
      setEditingBudget(null);
    } catch (err: any) {
      alert(err.message || "An error occurred while updating budget");
    } finally {
      setIsUpdatingBudget(false);
    }
  };

  const handleUpdateTransaction = async () => {
    if (!editingTx) return;
    
    setIsUpdatingTx(true);
    try {
      const tokens = localStorage.getItem("google_tokens");
      const fetchHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (tokens) {
        fetchHeaders["Authorization"] = `Bearer ${encodeURIComponent(tokens)}`;
      }

      const amount = parseFloat(editTxAmount);
      if (isNaN(amount)) {
        alert("Please enter a valid number");
        return;
      }

      // Ensure we maintain the correct sign for the spreadsheet
      const signedAmount = editingTx._isExpense ? -Math.abs(amount) : Math.abs(amount);

      const res = await fetch("/api/transaction/update", {
        method: "POST",
        headers: fetchHeaders,
        body: JSON.stringify({
          id: editingTx.id,
          amount: signedAmount,
          category: editTxCategory,
          subcategory: editTxSubcategory,
        }),
      });

      if (!res.ok) {
        const result = await res.json();
        throw new Error(result.error || "Failed to update transaction");
      }

      // Refresh data
      await fetchSheetData();
      setIsTxModalOpen(false);
      setEditingTx(null);
    } catch (err: any) {
      alert(err.message || "An error occurred while updating transaction");
    } finally {
      setIsUpdatingTx(false);
    }
  };

  const analyzeData = (rawData: any[], cols: string[]) => {
    // Try to identify column roles
    const dateCol = cols.find((c) => /date/i.test(c)) || cols[0];
    const amountCol =
      cols.find((c) => /amount|price|cost|value/i.test(c)) ||
      cols.find((c) => {
        // Check if first row has a number in this column
        const val = rawData[0]?.[c];
        return val && !isNaN(Number(val.replace(/[^0-9.-]+/g, "")));
      });
    const categoryCol =
      cols.find((c) => /category|type|group/i.test(c)) || cols[1];
    const subcategoryCol =
      cols.find((c) => /subcategory|sub-category|sub category/i.test(c));
    const descCol =
      cols.find((c) => /description|name|item|merchant/i.test(c)) || cols[2];

    if (!amountCol) {
      setError("Could not identify an Amount column for analysis.");
      return;
    }

    // First pass: extract all available years and parse dates
    const yearsSet = new Set<string>();
    const preParsedData = rawData.map((row, index) => {
      const dateStr = row[dateCol];
      let year = "Unknown";
      if (dateStr) {
        const parsedDate = new Date(dateStr);
        if (isValid(parsedDate)) {
          year = parsedDate.getFullYear().toString();
          yearsSet.add(year);
        }
      }
      return { ...row, _year: year, _rowIndex: index };
    });

    const sortedYears = Array.from(yearsSet).sort((a, b) => b.localeCompare(a));
    setAvailableYears(sortedYears);

    // Calculate global category totals and months for true average calculation
    const globalCategoryTotals: Record<string, number> = {};
    const globalIncomeSubcategoryTotals: Record<string, number> = {};
    const globalMonthsSet = new Set<string>();
    
    preParsedData.forEach(row => {
      const rawAmount = row[amountCol];
      if (!rawAmount) return;
      let amount = Number(String(rawAmount).replace(/[^0-9.-]+/g, ""));
      if (isNaN(amount)) return;
      
      const category = String(row[categoryCol] || "Uncategorized");
      const subcategory = String(subcategoryCol ? (row[subcategoryCol] || "") : "");
      const dateStr = row[dateCol];
      if (dateStr) {
        const parsedDate = new Date(dateStr);
        if (isValid(parsedDate)) {
          globalMonthsSet.add(format(parsedDate, "MMM yyyy"));
        }
      }
      
      if (amount < 0) {
        const absAmount = Math.abs(amount);
        globalCategoryTotals[category] = (globalCategoryTotals[category] || 0) + absAmount;
      } else if (amount > 0) {
        if (category.toLowerCase() === "transfer") return;
        
        let key = "";
        if (category.toLowerCase() === "income") {
          key = subcategory || "Other Income";
        } else {
          key = "Other";
        }
        globalIncomeSubcategoryTotals[key] = (globalIncomeSubcategoryTotals[key] || 0) + amount;
      }
    });

    const totalMonthsInDataset = globalMonthsSet.size || 1;
    
    const allCategoryNames = new Set([
      ...Object.keys(globalCategoryTotals),
      ...budgetData.map(b => String(Object.values(b)[0] || ""))
    ]);
    
    // 1. Identify all income subcategories from the entire dataset
    const allIncomeSubcategories = new Set<string>();
    preParsedData.forEach(row => {
      const category = String(row[categoryCol] || "");
      const subcategory = String(subcategoryCol ? (row[subcategoryCol] || "") : "");
      const rawAmount = row[amountCol];
      let amount = 0;
      if (rawAmount) {
        amount = Number(String(rawAmount).replace(/[^0-9.-]+/g, ""));
      }

      if (category.toLowerCase() === "income" && subcategory) {
        allIncomeSubcategories.add(subcategory);
      }
    });

    // Add "Other" if there are any "Other" transactions or a budget for "Other"
    const hasOtherIncomeTransactions = Object.keys(globalIncomeSubcategoryTotals).includes("Other");
    const hasOtherBudget = budgetData.some(b => {
      const catName = Object.values(b)[0];
      return catName && String(catName).toLowerCase() === "other";
    });

    // We'll calculate period-specific budget analysis after filtering data

    const currentYearStr = new Date().getFullYear().toString();
    const currentMonthStr = format(new Date(), "MMM yyyy");

    // If current year has no data and we haven't manually changed the year, 
    // default to the most recent available year
    if (selectedYear === currentYearStr && !yearsSet.has(currentYearStr) && sortedYears.length > 0) {
      setSelectedYear(sortedYears[0]);
      // We don't set month here yet, we'll let the month logic below handle it
      return; 
    }

    // Filter data by selected year
    const filteredData = selectedYear === "All" 
      ? preParsedData 
      : preParsedData.filter(row => row._year === selectedYear);

    // Clean and parse data
    let totalIncome = 0;
    let totalExpense = 0;
    const categoryTotals: Record<string, number> = {};
    const categoryMonthlyTotals: Record<string, Record<string, number>> = {};
    const categorySubcategoryTotals: Record<string, Record<string, number>> = {};
    const categorySubcategoryMonthlyTotals: Record<string, Record<string, Record<string, number>>> = {};
    const monthsSet = new Set<string>();
    const monthlyTotals: Record<string, { income: number; expense: number }> =
      {};

        const parsedData = filteredData
          .map((row) => {
            const rawAmount = row[amountCol];
            if (!rawAmount) return null;

            // Parse amount (handle currency symbols, commas)
            let amount = Number(String(rawAmount).replace(/[^0-9.-]+/g, ""));
            if (isNaN(amount)) return null;

            // Determine if expense or income based purely on the sign of the amount.
            const category = row[categoryCol] || "Uncategorized";
            const subcategory = subcategoryCol ? (row[subcategoryCol] || "") : "";
            const isExpense = amount < 0;

            amount = Math.abs(amount);

            const dateStr = row[dateCol];
            let date = new Date();
            let monthKey = "Unknown";

            if (dateStr) {
              const parsedDate = new Date(dateStr);
              if (isValid(parsedDate)) {
                date = parsedDate;
                monthKey = format(parsedDate, "MMM yyyy");
              }
            }

            monthsSet.add(monthKey);

            if (isExpense) {
              totalExpense += amount;
              categoryTotals[category] = (categoryTotals[category] || 0) + amount;
              
              if (!categoryMonthlyTotals[category]) {
                categoryMonthlyTotals[category] = {};
              }
              categoryMonthlyTotals[category][monthKey] = (categoryMonthlyTotals[category][monthKey] || 0) + amount;
              
              if (subcategory) {
                if (!categorySubcategoryTotals[category]) {
                  categorySubcategoryTotals[category] = {};
                }
                categorySubcategoryTotals[category][subcategory] = (categorySubcategoryTotals[category][subcategory] || 0) + amount;
                
                if (!categorySubcategoryMonthlyTotals[category]) {
                  categorySubcategoryMonthlyTotals[category] = {};
                }
                if (!categorySubcategoryMonthlyTotals[category][subcategory]) {
                  categorySubcategoryMonthlyTotals[category][subcategory] = {};
                }
                categorySubcategoryMonthlyTotals[category][subcategory][monthKey] = (categorySubcategoryMonthlyTotals[category][subcategory][monthKey] || 0) + amount;
              }
            } else {
              totalIncome += amount;
              
              // Track income by subcategory/other for income analysis
              let incomeKey = "";
              if (category.toLowerCase() === "income") {
                incomeKey = subcategory || "Other Income";
              } else {
                if (category.toLowerCase() !== "transfer") {
                  incomeKey = "Other";
                }
              }
              
              if (incomeKey) {
                if (!globalIncomeSubcategoryTotals[incomeKey]) globalIncomeSubcategoryTotals[incomeKey] = 0; // Ensure it's tracked
                // We'll use a local periodIncomeTotals for the period analysis
              }
            }

            if (!monthlyTotals[monthKey]) {
              monthlyTotals[monthKey] = { income: 0, expense: 0 };
            }
            if (isExpense) {
              monthlyTotals[monthKey].expense += amount;
            } else {
              monthlyTotals[monthKey].income += amount;
            }

            return {
              ...row,
              _parsedAmount: amount,
              _isExpense: isExpense,
              _category: category,
              _subcategory: subcategory,
              _date: date,
              _monthKey: monthKey,
            };
          })
          .filter((tx): tx is any => tx !== null)
          .sort((a, b) => b._date.getTime() - a._date.getTime());

    // Prepare chart data
    const categoryChartData = Object.entries(categoryTotals)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10); // Top 10 categories

    // Prepare full category table data
    const sortedMonths = Array.from(monthsSet).sort((a, b) => {
      return new Date(a).getTime() - new Date(b).getTime();
    });

    // Auto-select logic: If selectedMonth is not in the current data set, pick the best default
    if (selectedMonth !== "All Months" && !monthsSet.has(selectedMonth)) {
      // 1. Try current month (today) if it exists in this year's data
      if (monthsSet.has(currentMonthStr)) {
        setSelectedMonth(currentMonthStr);
        return;
      }
      // 2. Try the latest available month in this year
      if (sortedMonths.length > 0) {
        setSelectedMonth(sortedMonths[sortedMonths.length - 1]);
        return;
      }
      // 3. Fallback to All Months if no months found for this year
      setSelectedMonth("All Months");
      return;
    }

    // Calculate month-specific totals for KPIs and charts if a month is selected
    let displayIncome = totalIncome;
    let displayExpense = totalExpense;
    let displayCategoryChartData = Object.entries(categoryTotals)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    if (selectedMonth !== "All Months") {
      displayIncome = monthlyTotals[selectedMonth]?.income || 0;
      displayExpense = monthlyTotals[selectedMonth]?.expense || 0;
      
      const monthCategoryTotals: Record<string, number> = {};
      Object.entries(categoryMonthlyTotals).forEach(([cat, months]) => {
        if (months[selectedMonth]) {
          monthCategoryTotals[cat] = months[selectedMonth];
        }
      });
      
      displayCategoryChartData = Object.entries(monthCategoryTotals)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10);
    }

    const categoryTableData = Object.entries(categoryTotals)
      .filter(([name]) => {
        if (selectedMonth === "All Months") return true;
        return !!categoryMonthlyTotals[name]?.[selectedMonth];
      })
      .map(([name, total]) => {
        const displayTotal = selectedMonth === "All Months" ? total : (categoryMonthlyTotals[name]?.[selectedMonth] || 0);
        return {
          name,
          total: displayTotal,
          percentage: displayExpense > 0 ? (displayTotal / displayExpense) * 100 : 0,
          monthly: categoryMonthlyTotals[name] || {},
          subcategories: Object.entries(categorySubcategoryTotals[name] || {})
            .filter(([subName]) => {
              if (selectedMonth === "All Months") return true;
              return !!categorySubcategoryMonthlyTotals[name]?.[subName]?.[selectedMonth];
            })
            .map(([subName, subTotal]) => {
              const subDisplayTotal = selectedMonth === "All Months" ? subTotal : (categorySubcategoryMonthlyTotals[name]?.[subName]?.[selectedMonth] || 0);
              return { 
                name: subName, 
                total: subDisplayTotal,
                monthly: categorySubcategoryMonthlyTotals[name]?.[subName] || {}
              };
            })
            .sort((a, b) => b.total - a.total)
        };
      })
      .sort((a, b) => b.total - a.total);

    const monthlyChartData = Object.entries(monthlyTotals)
      .map(([name, data]) => ({ name, ...data }))
      // Sort by actual date if possible, for now just rely on object insertion order or simple sort
      .reverse();

    // Calculate period-specific budget analysis
    const periodMonths = selectedMonth === "All Months" ? monthsSet.size : 1;
    
    const budgetAnalysis = Array.from(allCategoryNames)
      .filter(name => {
        if (!name || name === "undefined" || name === "null" || name === "") return false;
        const lowerName = String(name).toLowerCase();
        if (["income", "expenses", "net", "transfer", "from savings"].includes(lowerName)) return false;
        if (allIncomeSubcategories.has(name)) return false;
        if (lowerName === "other" && (hasOtherIncomeTransactions || hasOtherBudget)) return false;
        return true;
      })
      .map(name => {
        const actual = selectedMonth === "All Months" 
          ? (categoryTotals[name] || 0) 
          : (categoryMonthlyTotals[name]?.[selectedMonth] || 0);
        
        const budgetRow = budgetData.find(b => {
          const catName = Object.values(b)[0];
          return catName && String(catName).toLowerCase() === name.toLowerCase();
        });
        
        let monthlyBudgetValue = 0;
        if (budgetRow) {
          const values = Object.values(budgetRow);
          if (values.length > 1) {
            monthlyBudgetValue = Number(String(values[1]).replace(/[^0-9.-]+/g, ""));
            if (isNaN(monthlyBudgetValue)) monthlyBudgetValue = 0;
          }
        }
        
        const periodBudgetValue = monthlyBudgetValue * periodMonths;
        const trueMonthlyAverage = (globalCategoryTotals[name] || 0) / totalMonthsInDataset;
        const scaledAverage = trueMonthlyAverage * periodMonths;
        
        return {
          name,
          actual: actual,
          monthlyAverage: scaledAverage,
          unscaledAverage: trueMonthlyAverage,
          budget: periodBudgetValue,
          monthlyBudget: monthlyBudgetValue,
          diff: actual - periodBudgetValue
        };
      })
      .sort((a, b) => b.actual - a.actual);

    const incomeAnalysisNames = Array.from(allIncomeSubcategories);
    if (hasOtherIncomeTransactions || hasOtherBudget) {
      incomeAnalysisNames.push("Other");
    }

    const incomeAnalysis = incomeAnalysisNames
      .map(name => {
        // Calculate period actual income for this subcategory
        let actual = 0;
        parsedData.forEach((t: any) => {
          if (!t || t._isExpense) return;
          if (selectedMonth !== "All Months" && t._monthKey !== selectedMonth) return;
          
          let incomeKey = "";
          if (t._category.toLowerCase() === "income") {
            incomeKey = t._subcategory || "Other Income";
          } else {
            if (t._category.toLowerCase() !== "transfer") {
              incomeKey = "Other";
            }
          }
          
          if (incomeKey === name) {
            actual += t._parsedAmount;
          }
        });

        const budgetRow = budgetData.find(b => {
          const catName = Object.values(b)[0];
          return catName && String(catName).toLowerCase() === name.toLowerCase();
        });
        
        let monthlyBudgetValue = 0;
        if (budgetRow) {
          const values = Object.values(budgetRow);
          if (values.length > 1) {
            monthlyBudgetValue = Number(String(values[1]).replace(/[^0-9.-]+/g, ""));
            if (isNaN(monthlyBudgetValue)) monthlyBudgetValue = 0;
          }
        }
        
        const periodBudgetValue = monthlyBudgetValue * periodMonths;
        const trueMonthlyAverage = (globalIncomeSubcategoryTotals[name] || 0) / totalMonthsInDataset;
        const scaledAverage = trueMonthlyAverage * periodMonths;
        
        return {
          name,
          actual: actual,
          monthlyAverage: scaledAverage,
          unscaledAverage: trueMonthlyAverage,
          budget: periodBudgetValue,
          monthlyBudget: monthlyBudgetValue,
          diff: actual - periodBudgetValue
        };
      })
      .sort((a, b) => b.actual - a.actual);

    setAnalysis({
      totalIncome: displayIncome,
      totalExpense: displayExpense,
      net: displayIncome - displayExpense,
      categoryChartData: displayCategoryChartData,
      monthlyChartData,
      categoryTableData,
      sortedMonths,
      transactionCount: parsedData.length,
      allTransactions: parsedData,
      budgetAnalysis,
      incomeAnalysis,
      periodMonths,
      columnsIdentified: {
        date: dateCol,
        amount: amountCol,
        category: categoryCol,
        subcategory: subcategoryCol,
        description: descCol,
      },
      categories: Array.from(new Set(parsedData.map((t: any) => t._category))).sort(),
      subcategories: Array.from(new Set(parsedData.map((t: any) => t._subcategory))).filter(Boolean).sort(),
    });
  };

  const navigateToTransactions = (category?: string, subcategory?: string) => {
    if (category) {
      setTxFilterCategory(category);
    } else {
      setTxFilterCategory("");
    }
    if (subcategory) {
      setTxFilterSubcategory(subcategory);
    } else {
      setTxFilterSubcategory("");
    }
    setTxFilterType("all");
    setCurrentView("transactions");
  };

  const filteredSubcategories = analysis?.allTransactions
    ? Array.from(
        new Set(
          analysis.allTransactions
            .filter((t: any) => !txFilterCategory || t._category === txFilterCategory)
            .map((t: any) => t._subcategory)
        )
      )
        .filter(Boolean)
        .sort() as string[]
    : [];

  const modalSubcategories = analysis?.allTransactions
    ? Array.from(
        new Set(
          analysis.allTransactions
            .filter((t: any) => t._category === editTxCategory)
            .map((t: any) => t._subcategory)
        )
      )
        .filter(Boolean)
        .sort() as string[]
    : [];

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden">
          <div className="p-8 text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <FileSpreadsheet className="w-8 h-8 text-blue-600" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 mb-2">
              Transaction Analyzer
            </h1>
            <p className="text-slate-500 mb-8">
              Connect your Google account to analyze and visualize your Google
              Sheets transaction data.
            </p>

            <button
              onClick={handleLogin}
              className="w-full flex items-center justify-center gap-3 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-medium py-3 px-4 rounded-xl transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
                <path d="M1 1h22v22H1z" fill="none" />
              </svg>
              Sign in with Google
            </button>
          </div>
          <div className="bg-slate-50 p-6 border-t border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
              <Settings className="w-4 h-4" /> Setup Required
            </h3>
            <ol className="text-xs text-slate-600 space-y-2 list-decimal list-inside">
              <li>Open Google Cloud Console</li>
              <li>Create OAuth 2.0 Client ID</li>
              <li>
                Add authorized redirect URI: <br />
                <code className="bg-slate-200 px-1 py-0.5 rounded text-slate-800 break-all">
                  {window.location.origin}/auth/callback
                </code>
              </li>
              <li>Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in AI Studio</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                <Activity className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                Analyzer
              </h1>
            </div>
            
            {analysis && (
              <nav className="hidden md:flex items-center gap-1">
                <button
                  onClick={() => setCurrentView("dashboard")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                    currentView === "dashboard"
                      ? "bg-blue-50 text-blue-600"
                      : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                  }`}
                >
                  <LayoutDashboard className="w-4 h-4" />
                  Dashboard
                </button>
                <button
                  onClick={() => navigateToTransactions()}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                    currentView === "transactions"
                      ? "bg-blue-50 text-blue-600"
                      : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                  }`}
                >
                  <List className="w-4 h-4" />
                  Transactions
                </button>
                <button
                  onClick={() => setCurrentView("budget")}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
                    currentView === "budget"
                      ? "bg-blue-50 text-blue-600"
                      : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                  }`}
                >
                  <Wallet className="w-4 h-4" />
                  Budget
                </button>
              </nav>
            )}
          </div>
          <div className="flex items-center gap-4">
            {isAuthenticated && (
              <button
                onClick={() => setIsImportModalOpen(true)}
                className="flex items-center gap-2 text-sm font-medium bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors"
              >
                <UploadCloud className="w-4 h-4" />
                <span className="hidden sm:inline">Import</span>
              </button>
            )}
            <button
              onClick={handleLogout}
              className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {error && (
          <div className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-start gap-3 text-red-700">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <p className="text-sm">{error}</p>
          </div>
        )}

        {loading && !analysis && (
          <div className="flex flex-col items-center justify-center py-20 text-slate-500">
            <RefreshCw className="w-8 h-8 animate-spin mb-4 text-blue-600" />
            <p>Analyzing your spreadsheet...</p>
          </div>
        )}

        {/* Analysis Results */}
        {analysis && currentView === "dashboard" && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Import UI */}
            <ReviewQueue 
              transactions={analysis.allTransactions || []} 
              onApprove={async (id, category, subcategory) => {
                const tokens = localStorage.getItem("google_tokens");
                const headers: Record<string, string> = { 'Content-Type': 'application/json' };
                if (tokens) headers['Authorization'] = `Bearer ${encodeURIComponent(tokens)}`;
                
                const tx = analysis.allTransactions.find((t: any) => t.id === id);
                if (!tx) throw new Error("Transaction not found");

                const res = await fetch("/api/transaction/update", {
                  method: "POST",
                  headers,
                  body: JSON.stringify({
                    id,
                    amount: tx.Amount,
                    category,
                    subcategory,
                    status: "reviewed"
                  })
                });
                if (!res.ok) throw new Error("Update failed");
                await fetchSheetData();
              }} 
            />
            
            <ImportHistory 
              getTokens={() => localStorage.getItem("google_tokens")} 
              onRollbackComplete={fetchSheetData} 
            />

            {/* Filter Bar */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <div>
                <h2 className="text-lg font-bold text-slate-900">Financial Overview</h2>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <label htmlFor="year-select-dashboard" className="text-sm font-medium text-slate-700">Year:</label>
                  <select
                    id="year-select-dashboard"
                    value={selectedYear}
                    onChange={(e) => {
                      setSelectedYear(e.target.value);
                      setSelectedMonth("All Months");
                    }}
                    className="bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 transition-all hover:bg-white"
                  >
                    <option value="All">All</option>
                    {availableYears.map(year => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="month-select-dashboard" className="text-sm font-medium text-slate-700">Month:</label>
                  <select
                    id="month-select-dashboard"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 transition-all hover:bg-white"
                  >
                    <option value="All Months">All</option>
                    {analysis.sortedMonths.map(month => (
                      <option key={month} value={month}>{month}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-emerald-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-500">
                      Total Income
                    </p>
                    <p className="text-2xl font-bold text-slate-900 whitespace-nowrap">
                      ${analysis.totalIncome.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-rose-100 rounded-full flex items-center justify-center">
                    <TrendingDown className="w-6 h-6 text-rose-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-500">
                      Total Expenses
                    </p>
                    <p className="text-2xl font-bold text-slate-900 whitespace-nowrap">
                      ${analysis.totalExpense.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                    <DollarSign className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-500">
                      Net Cash Flow
                    </p>
                    <p className={`text-2xl font-bold whitespace-nowrap ${analysis.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {analysis.net >= 0 ? '+' : '-'}${Math.abs(analysis.net).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Category Breakdown */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div 
                  className={`p-6 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors ${isTopExpensesExpanded ? 'border-b border-slate-100' : ''}`}
                  onClick={() => setIsTopExpensesExpanded(!isTopExpensesExpanded)}
                >
                  <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                    <PieChartIcon className="w-5 h-5 text-slate-400" />
                    Top Expenses by Category
                  </h3>
                  {isTopExpensesExpanded ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </div>
                {isTopExpensesExpanded && (
                  <div 
                    className="p-6 flex flex-col md:flex-row items-start justify-center gap-8 animate-in slide-in-from-top-2 duration-200"
                    onMouseLeave={() => setHoveredCategory(null)}
                  >
                    <div className="h-64 w-full md:w-1/2">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={analysis.categoryChartData}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={100}
                            paddingAngle={2}
                            dataKey="value"
                            nameKey="name"
                            startAngle={90}
                            endAngle={-270}
                            onClick={(data) => navigateToTransactions(String(data.name))}
                            onMouseEnter={(_, index) => {
                              const name = analysis.categoryChartData[index]?.name;
                              if (name) setHoveredCategory(name);
                            }}
                            onMouseLeave={() => setHoveredCategory(null)}
                            cursor="pointer"
                          >
                            {analysis.categoryChartData.map((entry: any) => (
                              <Cell
                                key={`cell-${entry.name}`}
                                fill={getCategoryColor(entry.name) || "#cbd5e1"}
                                opacity={hoveredCategory === null || hoveredCategory === entry.name ? 1 : 0.3}
                                style={{ transition: 'opacity 0.2s ease' }}
                              />
                            ))}
                          </Pie>
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex flex-col gap-2 w-full md:w-1/2">
                      {analysis.categoryChartData.map((item: any) => (
                        <div 
                          key={item.name} 
                          className="flex items-center justify-between text-sm cursor-pointer hover:bg-slate-50 p-1 rounded transition-all"
                          style={{ opacity: hoveredCategory === null || hoveredCategory === item.name ? 1 : 0.3 }}
                          onClick={() => navigateToTransactions(item.name)}
                          onMouseEnter={() => setHoveredCategory(item.name)}
                          onMouseLeave={() => setHoveredCategory(null)}
                        >
                          <div className="flex items-center gap-3">
                            <div 
                              className="w-3 h-3 rounded-full shrink-0" 
                              style={{ backgroundColor: getCategoryColor(item.name) || "#cbd5e1" }}
                            />
                            <span className="text-slate-600 font-medium truncate max-w-[150px]" title={item.name}>
                              {item.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-slate-400 text-xs">
                              {analysis.totalExpense > 0 ? ((item.value / analysis.totalExpense) * 100).toFixed(1) : '0.0'}%
                            </span>
                            <span className="font-semibold text-slate-900">
                              ${item.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

            </div>

            {/* Category Table */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div 
                className="p-6 flex items-center justify-between cursor-pointer border-b border-slate-100"
                onClick={() => setIsCategoryTableExpanded(!isCategoryTableExpanded)}
              >
                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                  <LayoutList className="w-5 h-5 text-slate-400" />
                  All Expenses by Category
                </h3>
                <div className="flex items-center gap-6">
                  {selectedMonth === "All Months" && (
                    <label 
                      className="flex items-center gap-2 cursor-pointer group"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={showTableTotals}
                        onChange={(e) => setShowTableTotals(e.target.checked)}
                        className="w-4 h-4 text-blue-600 bg-slate-100 border-slate-300 rounded focus:ring-blue-500 transition-colors"
                      />
                      <span className="text-sm font-medium text-slate-600 group-hover:text-slate-900 transition-colors">Show Totals</span>
                    </label>
                  )}
                  {isCategoryTableExpanded ? (
                    <ChevronUp className="w-5 h-5 text-slate-400" />
                  ) : (
                    <ChevronDown className="w-5 h-5 text-slate-400" />
                  )}
                </div>
              </div>
              {isCategoryTableExpanded && (
                <div className="overflow-x-auto max-h-[600px]">
                  <table className="w-full text-sm text-left border-separate border-spacing-0">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-20">
                      <tr>
                        <th className="px-6 py-4 font-semibold sticky left-0 top-0 bg-slate-50 z-30 border-b border-slate-100">Category</th>
                        <th className="px-6 py-4 font-semibold text-right border-b border-slate-100">%</th>
                        {analysis.sortedMonths
                          .filter(month => selectedMonth === "All Months" || month === selectedMonth)
                          .map((month: string) => (
                          <th 
                            key={month} 
                            className="px-6 py-4 font-semibold text-right whitespace-nowrap border-b border-slate-100 cursor-pointer hover:bg-slate-100 transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedMonth(month);
                            }}
                          >
                            {month}
                          </th>
                        ))}
                        {showTableTotals && selectedMonth === "All Months" && (
                          <th className="px-6 py-4 font-semibold text-right whitespace-nowrap bg-slate-50 border-b border-slate-100">
                            {selectedMonth === "All Months" ? "Total" : `${selectedMonth} Total`}
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {analysis.categoryTableData.map((row: any) => {
                        const dotColor = getCategoryColor(row.name);
                        const isExpanded = expandedCategories.has(row.name);
                        const hasSubcategories = row.subcategories && row.subcategories.length > 0;

                        return (
                          <React.Fragment key={row.name}>
                            <tr className="hover:bg-slate-50 transition-colors cursor-pointer group" onClick={() => navigateToTransactions(row.name)}>
                              <td className="px-6 py-4 font-medium text-slate-900 sticky left-0 bg-white group-hover:bg-slate-50 z-10 border-r border-slate-50 border-b border-slate-100">
                                <div className="flex items-center gap-2">
                                  <div className="w-6 flex-shrink-0 flex items-center justify-center">
                                    {hasSubcategories && (
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const newExpanded = new Set(expandedCategories);
                                          if (newExpanded.has(row.name)) newExpanded.delete(row.name);
                                          else newExpanded.add(row.name);
                                          setExpandedCategories(newExpanded);
                                        }}
                                        className="p-1 hover:bg-slate-100 rounded transition-colors text-slate-400 hover:text-slate-600"
                                      >
                                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                      </button>
                                    )}
                                  </div>
                                  {dotColor && (
                                    <div 
                                      className="w-2 h-2 rounded-full shrink-0" 
                                      style={{ backgroundColor: dotColor }}
                                    />
                                  )}
                                  {row.name}
                                </div>
                              </td>
                              <td className="px-6 py-4 text-right text-slate-400 text-xs font-medium border-b border-slate-100">
                                {row.percentage.toFixed(1)}%
                              </td>
                              {analysis.sortedMonths
                                .filter(month => selectedMonth === "All Months" || month === selectedMonth)
                                .map((month: string) => (
                                <td key={month} className="px-6 py-4 text-right text-slate-600 font-mono border-b border-slate-100">
                                  {row.monthly[month] 
                                    ? `$${row.monthly[month].toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                    : "-"
                                  }
                                </td>
                              ))}
                              {showTableTotals && selectedMonth === "All Months" && (
                                <td className="px-6 py-4 text-right font-bold text-slate-900 bg-slate-50/50 font-mono border-b border-slate-100">
                                  ${row.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                              )}
                            </tr>
                            {isExpanded && row.subcategories.map((sub: any) => (
                              <tr 
                                key={`${row.name}-${sub.name}`} 
                                className="bg-slate-50/30 text-xs hover:bg-slate-100 transition-colors cursor-pointer group/sub"
                                onClick={() => navigateToTransactions(row.name, sub.name)}
                              >
                                <td className="pl-12 pr-6 py-2 text-slate-500 italic sticky left-0 bg-slate-50/30 group-hover/sub:bg-slate-100 z-10 border-r border-slate-50 border-b border-slate-100">
                                  {sub.name}
                                </td>
                                <td className="px-6 py-2 text-right text-slate-400 border-b border-slate-100">
                                  {((sub.total / row.total) * 100).toFixed(1)}%
                                </td>
                                {analysis.sortedMonths
                                  .filter(month => selectedMonth === "All Months" || month === selectedMonth)
                                  .map((month: string) => (
                                  <td key={month} className="px-6 py-2 text-right text-slate-400 font-mono border-b border-slate-100">
                                    {sub.monthly[month] 
                                      ? `$${sub.monthly[month].toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                      : "-"
                                    }
                                  </td>
                                ))}
                                {showTableTotals && selectedMonth === "All Months" && (
                                  <td className="px-6 py-2 text-right font-medium text-slate-500 bg-slate-50/20 font-mono border-b border-slate-100">
                                    ${sub.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </td>
                                )}
                              </tr>
                            ))}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                    {(showTableTotals || selectedMonth !== "All Months") && (
                      <tfoot className="bg-slate-50 font-bold border-t-2 border-slate-200 sticky bottom-0 z-20">
                        <tr>
                          <td className="px-6 py-4 sticky left-0 bottom-0 bg-slate-50 z-30 border-t border-slate-200">
                            {selectedMonth === "All Months" ? "Total" : `${selectedMonth} Total`}
                          </td>
                          <td className="px-6 py-4 text-right text-slate-400 text-xs font-bold border-t border-slate-200">100%</td>
                          {analysis.sortedMonths
                            .filter(month => selectedMonth === "All Months" || month === selectedMonth)
                            .map((month: string) => {
                            const monthTotal = analysis.allTransactions
                              .filter((t: any) => t._monthKey === month && t._isExpense)
                              .reduce((sum: number, t: any) => sum + t._parsedAmount, 0);
                            return (
                              <td key={month} className="px-6 py-4 text-right font-mono border-t border-slate-200">
                                ${monthTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                            );
                          })}
                          {showTableTotals && selectedMonth === "All Months" && (
                            <td className="px-6 py-4 text-right font-mono bg-slate-100 border-t border-slate-200">
                              ${analysis.totalExpense.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                          )}
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {analysis && currentView === "budget" && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Filter Bar */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setCurrentView("dashboard")}
                  className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-500"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
                <h2 className="text-lg font-bold text-slate-900">Budget Analysis</h2>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <label htmlFor="year-select-budget" className="text-sm font-medium text-slate-700">Year:</label>
                  <select
                    id="year-select-budget"
                    value={selectedYear}
                    onChange={(e) => {
                      setSelectedYear(e.target.value);
                      setSelectedMonth("All Months");
                    }}
                    className="bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 transition-all hover:bg-white"
                  >
                    <option value="All">All</option>
                    {availableYears.map(year => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor="month-select-budget" className="text-sm font-medium text-slate-700">Month:</label>
                  <select
                    id="month-select-budget"
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2 transition-all hover:bg-white"
                  >
                    <option value="All Months">All</option>
                    {analysis.sortedMonths.map(month => (
                      <option key={month} value={month}>{month}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => setShowBudgetAverage(!showBudgetAverage)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border transition-all text-xs font-bold uppercase tracking-wider ${
                    showBudgetAverage 
                      ? "bg-slate-900 border-slate-900 text-white shadow-sm" 
                      : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  {showBudgetAverage ? "Hide Average" : "Show Average"}
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div 
                className="p-6 border-b border-slate-100 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() => setIsBudgetExpensesExpanded(!isBudgetExpensesExpanded)}
              >
                <div className="flex items-center gap-3">
                  <TrendingDown className="w-5 h-5 text-red-500" />
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">
                      Expenses: Actual vs. Budgeted {analysis.periodMonths > 1 && `(${analysis.periodMonths} Months)`}
                    </h3>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {!isBudgetExpensesExpanded && (
                    <div className="flex items-center gap-6 text-sm font-mono">
                      <div className="text-right">
                        <div className="text-[10px] uppercase text-slate-400 font-sans font-bold">Budgeted</div>
                        <div className="text-slate-900">${Math.round(analysis.budgetAnalysis.reduce((sum: number, r: any) => sum + r.actual, 0)).toLocaleString()}</div>
                      </div>
                      {showBudgetAverage && (
                        <div className="text-right">
                          <div className="text-[10px] uppercase text-slate-400 font-sans font-bold">Average</div>
                          <div className="text-slate-900">${Math.round(analysis.budgetAnalysis.reduce((sum: number, r: any) => sum + r.monthlyAverage, 0)).toLocaleString()}</div>
                        </div>
                      )}
                      <div className="text-right">
                        <div className="text-[10px] uppercase text-slate-400 font-sans font-bold">Budgeted</div>
                        <div className="text-slate-900">${Math.round(analysis.budgetAnalysis.reduce((sum: number, r: any) => sum + r.budget, 0)).toLocaleString()}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] uppercase text-slate-400 font-sans font-bold">Diff</div>
                        <div className={analysis.budgetAnalysis.reduce((sum: number, r: any) => sum + r.diff, 0) > 0 ? "text-red-600" : "text-emerald-600"}>
                          {(() => {
                            const totalDiff = analysis.budgetAnalysis.reduce((sum: number, r: any) => sum + r.diff, 0);
                            return (totalDiff > 0 ? "+$" : (totalDiff < 0 ? "-$" : "$")) + Math.abs(Math.round(totalDiff)).toLocaleString();
                          })()}
                        </div>
                      </div>
                    </div>
                  )}
                  {isBudgetExpensesExpanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                </div>
              </div>
              {isBudgetExpensesExpanded && (
                <div className="overflow-x-auto max-h-[700px] animate-in slide-in-from-top-2 duration-200">
                  <table className="w-full text-sm text-left border-separate border-spacing-0">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-20">
                      <tr>
                        <th className="px-6 py-4 font-semibold border-b border-slate-100 sticky top-0 bg-slate-50 z-10">Category</th>
                        <th className="px-6 py-4 font-semibold text-right border-b border-slate-100 sticky top-0 bg-slate-50 z-10">Actual</th>
                        {showBudgetAverage && (
                          <th className="px-6 py-4 font-semibold text-right border-b border-slate-100 sticky top-0 bg-slate-50 z-10">Average</th>
                        )}
                        <th className="px-6 py-4 font-semibold text-right border-b border-slate-100 sticky top-0 bg-slate-50 z-10">Budgeted</th>
                        <th className="px-6 py-4 font-semibold text-right border-b border-slate-100 sticky top-0 bg-slate-50 z-10">Difference</th>
                        <th className="px-6 py-4 font-semibold text-center border-b border-slate-100 sticky top-0 bg-slate-50 z-10">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {analysis.budgetAnalysis.map((row: any) => {
                        const isWithinTenDollars = row.budget > 0 && Math.abs(row.diff) < 10;
                        const isOverBudget = row.budget > 0 && row.diff >= 10;
                        const isUnderBudget = row.budget > 0 && row.diff <= -10;
                        
                        return (
                          <tr key={row.name} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4 font-medium text-slate-900 border-b border-slate-100">
                              <div className="flex items-center gap-2">
                                <div 
                                  className="w-2 h-2 rounded-full shrink-0" 
                                  style={{ backgroundColor: getCategoryColor(row.name) || "#cbd5e1" }}
                                />
                                {row.name}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-right text-slate-600 font-mono border-b border-slate-100">
                              ${Math.round(row.actual).toLocaleString()}
                            </td>
                            {showBudgetAverage && (
                              <td className="px-6 py-4 text-right text-slate-600 font-mono border-b border-slate-100">
                                ${Math.round(row.monthlyAverage).toLocaleString()}
                              </td>
                            )}
                            <td 
                              className="px-6 py-4 text-right text-slate-600 font-mono border-b border-slate-100 cursor-pointer hover:bg-slate-100 transition-colors group"
                              onClick={() => {
                                setEditingBudget({
                                  category: row.name,
                                  actual: row.actual,
                                  average: row.monthlyAverage,
                                  unscaledAverage: row.unscaledAverage,
                                  current: row.budget,
                                  monthlyBudget: row.monthlyBudget
                                });
                                setNewBudgetValue(row.monthlyBudget > 0 ? row.monthlyBudget.toString() : "0");
                                setIsBudgetModalOpen(true);
                              }}
                            >
                              <div className="flex items-center justify-end relative">
                                {row.budget > 0 
                                  ? `$${Math.round(row.budget).toLocaleString()}`
                                  : <span className="text-slate-300 italic text-xs">Not set</span>
                                }
                                <Settings className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity absolute -right-5" />
                              </div>
                            </td>
                            <td className={`px-6 py-4 text-right font-mono border-b border-slate-100 ${
                              row.budget > 0 
                                ? (isWithinTenDollars ? "text-slate-500" : (row.diff > 0 ? "text-red-600" : "text-emerald-600"))
                                : "text-slate-400"
                            }`}>
                              {row.budget > 0 
                                ? (isWithinTenDollars 
                                    ? "$" + Math.abs(Math.round(row.diff)).toLocaleString()
                                    : (row.diff > 0 ? "+$" : (row.diff < 0 ? "-$" : "$")) + Math.abs(Math.round(row.diff)).toLocaleString())
                                : "-"
                              }
                            </td>
                            <td className="px-6 py-4 text-center border-b border-slate-100">
                              {row.budget > 0 ? (
                                isWithinTenDollars ? (
                                  <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600">
                                    On Budget
                                  </span>
                                ) : (
                                  <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                    isOverBudget 
                                      ? "bg-red-100 text-red-700" 
                                      : "bg-emerald-100 text-emerald-700"
                                  }`}>
                                    {isOverBudget ? "Over" : "Under"}
                                  </span>
                                )
                              ) : (
                                <span className="text-slate-300 text-[10px] font-bold uppercase tracking-wider">
                                  N/A
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-slate-50 font-bold">
                      <tr>
                        <td className="px-6 py-4 text-slate-900 border-t border-slate-200">TOTAL</td>
                        <td className="px-6 py-4 text-right text-slate-900 font-mono border-t border-slate-200">
                          ${Math.round(analysis.budgetAnalysis.reduce((sum: number, r: any) => sum + r.actual, 0)).toLocaleString()}
                        </td>
                        {showBudgetAverage && (
                          <td className="px-6 py-4 text-right text-slate-900 font-mono border-t border-slate-200">
                            ${Math.round(analysis.budgetAnalysis.reduce((sum: number, r: any) => sum + r.monthlyAverage, 0)).toLocaleString()}
                          </td>
                        )}
                        <td className="px-6 py-4 text-right text-slate-900 font-mono border-t border-slate-200">
                          ${Math.round(analysis.budgetAnalysis.reduce((sum: number, r: any) => sum + r.budget, 0)).toLocaleString()}
                        </td>
                        <td className={`px-6 py-4 text-right font-mono border-t border-slate-200 ${
                          analysis.budgetAnalysis.reduce((sum: number, r: any) => sum + r.diff, 0) > 0 ? "text-red-600" : "text-emerald-600"
                        }`}>
                          {(() => {
                            const totalDiff = analysis.budgetAnalysis.reduce((sum: number, r: any) => sum + r.diff, 0);
                            return (totalDiff > 0 ? "+$" : (totalDiff < 0 ? "-$" : "$")) + Math.abs(Math.round(totalDiff)).toLocaleString();
                          })()}
                        </td>
                        <td className="px-6 py-4 border-t border-slate-200"></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div 
                className="p-6 border-b border-slate-100 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors"
                onClick={() => setIsBudgetIncomeExpanded(!isBudgetIncomeExpanded)}
              >
                <div className="flex items-center gap-3">
                  <TrendingUp className="w-5 h-5 text-emerald-500" />
                  <div>
                    <h3 className="text-lg font-bold text-slate-900">
                      Income: Actual vs. Budgeted {analysis.periodMonths > 1 && `(${analysis.periodMonths} Months)`}
                    </h3>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  {!isBudgetIncomeExpanded && (
                    <div className="flex items-center gap-6 text-sm font-mono">
                      <div className="text-right">
                        <div className="text-[10px] uppercase text-slate-400 font-sans font-bold">Actual</div>
                        <div className="text-slate-900">${Math.round(analysis.incomeAnalysis.reduce((sum: number, r: any) => sum + r.actual, 0)).toLocaleString()}</div>
                      </div>
                      {showBudgetAverage && (
                        <div className="text-right">
                          <div className="text-[10px] uppercase text-slate-400 font-sans font-bold">Average</div>
                          <div className="text-slate-900">${Math.round(analysis.incomeAnalysis.reduce((sum: number, r: any) => sum + r.monthlyAverage, 0)).toLocaleString()}</div>
                        </div>
                      )}
                      <div className="text-right">
                        <div className="text-[10px] uppercase text-slate-400 font-sans font-bold">Budgeted</div>
                        <div className="text-slate-900">${Math.round(analysis.incomeAnalysis.reduce((sum: number, r: any) => sum + r.budget, 0)).toLocaleString()}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] uppercase text-slate-400 font-sans font-bold">Diff</div>
                        <div className={analysis.incomeAnalysis.reduce((sum: number, r: any) => sum + r.diff, 0) > 0 ? "text-emerald-600" : "text-red-600"}>
                          {(() => {
                            const totalDiff = analysis.incomeAnalysis.reduce((sum: number, r: any) => sum + r.diff, 0);
                            return (totalDiff > 0 ? "+$" : (totalDiff < 0 ? "-$" : "$")) + Math.abs(Math.round(totalDiff)).toLocaleString();
                          })()}
                        </div>
                      </div>
                    </div>
                  )}
                  {isBudgetIncomeExpanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
                </div>
              </div>
              {isBudgetIncomeExpanded && (
                <div className="overflow-x-auto max-h-[700px] animate-in slide-in-from-top-2 duration-200">
                  <table className="w-full text-sm text-left border-separate border-spacing-0">
                    <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-20">
                      <tr>
                        <th className="px-6 py-4 font-semibold border-b border-slate-100 sticky top-0 bg-slate-50 z-10">Category</th>
                        <th className="px-6 py-4 font-semibold text-right border-b border-slate-100 sticky top-0 bg-slate-50 z-10">Actual</th>
                        {showBudgetAverage && (
                          <th className="px-6 py-4 font-semibold text-right border-b border-slate-100 sticky top-0 bg-slate-50 z-10">Average</th>
                        )}
                        <th className="px-6 py-4 font-semibold text-right border-b border-slate-100 sticky top-0 bg-slate-50 z-10">Budgeted</th>
                        <th className="px-6 py-4 font-semibold text-right border-b border-slate-100 sticky top-0 bg-slate-50 z-10">Difference</th>
                        <th className="px-6 py-4 font-semibold text-center border-b border-slate-100 sticky top-0 bg-slate-50 z-10">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {analysis.incomeAnalysis.map((row: any) => {
                        const isWithinTenDollars = row.budget > 0 && Math.abs(row.diff) < 10;
                        const isOverBudget = row.budget > 0 && row.diff >= 10; // Earned more
                        const isUnderBudget = row.budget > 0 && row.diff <= -10; // Earned less
                        
                        return (
                          <tr key={row.name} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-4 font-medium text-slate-900 border-b border-slate-100">
                              <div className="flex items-center gap-2">
                                <div 
                                  className="w-2 h-2 rounded-full shrink-0" 
                                  style={{ backgroundColor: getCategoryColor(row.name) || "#cbd5e1" }}
                                />
                                {row.name}
                              </div>
                            </td>
                            <td className="px-6 py-4 text-right text-slate-600 font-mono border-b border-slate-100">
                              ${Math.round(row.actual).toLocaleString()}
                            </td>
                            {showBudgetAverage && (
                              <td className="px-6 py-4 text-right text-slate-600 font-mono border-b border-slate-100">
                                ${Math.round(row.monthlyAverage).toLocaleString()}
                              </td>
                            )}
                            <td 
                              className="px-6 py-4 text-right text-slate-600 font-mono border-b border-slate-100 cursor-pointer hover:bg-slate-100 transition-colors group"
                              onClick={() => {
                                setEditingBudget({
                                  category: row.name,
                                  actual: row.actual,
                                  average: row.monthlyAverage,
                                  unscaledAverage: row.unscaledAverage,
                                  current: row.budget,
                                  monthlyBudget: row.monthlyBudget
                                });
                                setNewBudgetValue(row.monthlyBudget > 0 ? row.monthlyBudget.toString() : "0");
                                setIsBudgetModalOpen(true);
                              }}
                            >
                              <div className="flex items-center justify-end relative">
                                {row.budget > 0 
                                  ? `$${Math.round(row.budget).toLocaleString()}`
                                  : <span className="text-slate-300 italic text-xs">Not set</span>
                                }
                                <Settings className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-opacity absolute -right-5" />
                              </div>
                            </td>
                            <td className={`px-6 py-4 text-right font-mono border-b border-slate-100 ${
                              row.budget > 0 
                                ? (isWithinTenDollars ? "text-slate-500" : (row.diff > 0 ? "text-emerald-600" : "text-red-600"))
                                : "text-slate-400"
                            }`}>
                              {row.budget > 0 
                                ? (isWithinTenDollars 
                                    ? "$" + Math.abs(Math.round(row.diff)).toLocaleString()
                                    : (row.diff > 0 ? "+$" : (row.diff < 0 ? "-$" : "$")) + Math.abs(Math.round(row.diff)).toLocaleString())
                                : "-"
                              }
                            </td>
                            <td className="px-6 py-4 text-center border-b border-slate-100">
                              {row.budget > 0 ? (
                                isWithinTenDollars ? (
                                  <span className="px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-600">
                                    On Budget
                                  </span>
                                ) : (
                                  <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                    isOverBudget 
                                      ? "bg-emerald-100 text-emerald-700" 
                                      : "bg-red-100 text-red-700"
                                  }`}>
                                    {isOverBudget ? "Over" : "Under"}
                                  </span>
                                )
                              ) : (
                                <span className="text-slate-300 text-[10px] font-bold uppercase tracking-wider">
                                  N/A
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-slate-50 font-bold">
                      <tr>
                        <td className="px-6 py-4 text-slate-900 border-t border-slate-200">TOTAL</td>
                        <td className="px-6 py-4 text-right text-slate-900 font-mono border-t border-slate-200">
                          ${Math.round(analysis.incomeAnalysis.reduce((sum: number, r: any) => sum + r.actual, 0)).toLocaleString()}
                        </td>
                        {showBudgetAverage && (
                          <td className="px-6 py-4 text-right text-slate-900 font-mono border-t border-slate-200">
                            ${Math.round(analysis.incomeAnalysis.reduce((sum: number, r: any) => sum + r.monthlyAverage, 0)).toLocaleString()}
                          </td>
                        )}
                        <td className="px-6 py-4 text-right text-slate-900 font-mono border-t border-slate-200">
                          ${Math.round(analysis.incomeAnalysis.reduce((sum: number, r: any) => sum + r.budget, 0)).toLocaleString()}
                        </td>
                        <td className={`px-6 py-4 text-right font-mono border-t border-slate-200 ${
                          analysis.incomeAnalysis.reduce((sum: number, r: any) => sum + r.diff, 0) > 0 ? "text-emerald-600" : "text-red-600"
                        }`}>
                          {(() => {
                            const totalDiff = analysis.incomeAnalysis.reduce((sum: number, r: any) => sum + r.diff, 0);
                            return (totalDiff > 0 ? "+$" : (totalDiff < 0 ? "-$" : "$")) + Math.abs(Math.round(totalDiff)).toLocaleString();
                          })()}
                        </td>
                        <td className="px-6 py-4 border-t border-slate-200"></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {analysis && currentView === "transactions" && (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
              <button
                onClick={() => setCurrentView("dashboard")}
                className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Dashboard
              </button>
              <h2 className="text-2xl font-bold text-slate-900">Transaction List</h2>
              <div className="w-24"></div> {/* Spacer */}
            </div>

            {/* Filters */}
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-slate-200">
              <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Year</label>
                  <select
                    value={selectedYear}
                    onChange={(e) => {
                      setSelectedYear(e.target.value);
                      setSelectedMonth("All Months");
                    }}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
                  >
                    <option value="All">All</option>
                    {availableYears.map(year => (
                      <option key={year} value={year}>{year}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Month</label>
                  <select
                    value={selectedMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
                  >
                    <option value="All Months">All</option>
                    {analysis.sortedMonths.map(month => (
                      <option key={month} value={month}>{month}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Category</label>
                  <select
                    value={txFilterCategory}
                    onChange={(e) => {
                      setTxFilterCategory(e.target.value);
                      setTxFilterSubcategory("");
                    }}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
                  >
                    <option value="">All</option>
                    {analysis.categories.map((cat: string) => (
                      <option key={cat} value={cat}>{cat}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Subcategory</label>
                  <select
                    value={txFilterSubcategory}
                    onChange={(e) => setTxFilterSubcategory(e.target.value)}
                    disabled={!txFilterCategory}
                    className={`w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5 ${
                      !txFilterCategory ? "opacity-50 cursor-not-allowed" : ""
                    }`}
                  >
                    <option value="">All</option>
                    {filteredSubcategories.map((sub: string) => (
                      <option key={sub} value={sub}>
                        {sub}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">Type</label>
                  <select
                    value={txFilterType}
                    onChange={(e) => setTxFilterType(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block p-2.5"
                  >
                    <option value="all">All</option>
                    <option value="income">Income Only</option>
                    <option value="expense">Expense Only</option>
                  </select>
                </div>
                <div className="flex items-end gap-4">
                  <label className="flex items-center gap-2 cursor-pointer group mb-0.5">
                    <input
                      type="checkbox"
                      checked={showTxTotals}
                      onChange={(e) => setShowTxTotals(e.target.checked)}
                      className="w-4 h-4 text-blue-600 bg-slate-100 border-slate-300 rounded focus:ring-blue-500 transition-colors"
                    />
                    <span className="text-sm font-medium text-slate-600 group-hover:text-slate-900 transition-colors whitespace-nowrap">Totals</span>
                  </label>
                  <button
                    onClick={() => {
                      setTxFilterCategory("");
                      setTxFilterSubcategory("");
                      setTxFilterType("all");
                      setSelectedYear("All");
                      setSelectedMonth("All Months");
                    }}
                    className="mb-1 text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors uppercase tracking-wider"
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>

            {/* Transaction Table */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto max-h-[700px]">
                <table className="w-full text-sm text-left border-separate border-spacing-0">
                  <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0 z-20">
                    <tr>
                      {headers.filter(h => !/year|month|notes/i.test(h)).map((header) => {
                        const isAmount = header === analysis.columnsIdentified.amount;
                        const isCategory = header === analysis.columnsIdentified.category;
                        const isSubcategory = header === analysis.columnsIdentified.subcategory;
                        const isDescription = header === analysis.columnsIdentified.description;
                        
                        let widthClass = 'whitespace-nowrap';
                        if (isCategory || isSubcategory) widthClass = 'min-w-[100px] max-w-[150px] break-words';
                        if (isDescription) widthClass = 'min-w-[200px] break-words';

                        return (
                          <th key={header} className={`px-6 py-4 font-semibold border-b border-slate-100 bg-slate-50 ${widthClass}`}>
                            {header}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {analysis.allTransactions
                      .filter((tx: any) => {
                        if (selectedMonth !== "All Months" && tx._monthKey !== selectedMonth) return false;
                        if (txFilterCategory && tx._category !== txFilterCategory) return false;
                        if (txFilterSubcategory && tx._subcategory !== txFilterSubcategory) return false;
                        if (txFilterType === "income" && tx._isExpense) return false;
                        if (txFilterType === "expense" && !tx._isExpense) return false;
                        return true;
                      })
                      .map((tx: any, idx: number) => (
                        <tr 
                          key={idx} 
                          className="hover:bg-slate-50 transition-colors cursor-pointer group"
                          onClick={() => {
                            setEditingTx(tx);
                            setEditTxAmount(tx._parsedAmount.toFixed(2));
                            setEditTxCategory(tx._category);
                            setEditTxSubcategory(tx._subcategory);
                            setIsTxModalOpen(true);
                          }}
                        >
                          {headers.filter(h => !/year|month|notes/i.test(h)).map((header) => {
                            const val = tx[header];
                            const isAmount = header === analysis.columnsIdentified.amount;
                            const isCategory = header === analysis.columnsIdentified.category;
                            const isSubcategory = header === analysis.columnsIdentified.subcategory;
                            const isDescription = header === analysis.columnsIdentified.description;
                            
                            let dotColor = null;
                            if (isCategory) {
                              dotColor = getCategoryColor(String(val));
                            }
                            
                            let cellClass = 'whitespace-nowrap';
                            if (isAmount) cellClass = 'font-mono text-right whitespace-nowrap';
                            if (isCategory || isSubcategory) cellClass = 'break-words min-w-[100px] max-w-[150px]';
                            if (isDescription) cellClass = 'break-words min-w-[200px]';

                            return (
                              <td 
                                key={header} 
                                className={`px-6 py-4 border-b border-slate-100 ${cellClass} ${(isCategory || isSubcategory) ? 'hover:underline cursor-pointer font-medium' : ''}`}
                                onClick={(e) => {
                                  if (isCategory || isSubcategory) {
                                    e.stopPropagation();
                                    if (isCategory) setTxFilterCategory(String(val));
                                    if (isSubcategory) setTxFilterSubcategory(String(val));
                                  }
                                }}
                              >
                                {isAmount ? (
                                  <span className={tx._isExpense ? 'text-slate-900' : 'text-emerald-600 font-bold'}>
                                    ${tx._parsedAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                ) : isCategory ? (
                                  <div className="flex items-center gap-2">
                                    {dotColor && (
                                      <div 
                                        className="w-2 h-2 rounded-full shrink-0" 
                                        style={{ backgroundColor: dotColor }}
                                      />
                                    )}
                                    {String(val)}
                                  </div>
                                ) : (
                                  val
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                  </tbody>
                  {showTxTotals && (
                    <tfoot className="bg-slate-50 font-bold border-t-2 border-slate-200 sticky bottom-0 z-20">
                      <tr>
                        {headers.filter(h => !/year|month|notes/i.test(h)).map((header, idx) => {
                          const isAmount = header === analysis.columnsIdentified.amount;
                          if (idx === 0) return <td key={header} className="px-6 py-4 border-t border-slate-200">Total</td>;
                          if (isAmount) {
                            const filtered = analysis.allTransactions.filter((tx: any) => {
                              if (selectedMonth !== "All Months" && tx._monthKey !== selectedMonth) return false;
                              if (txFilterCategory && tx._category !== txFilterCategory) return false;
                              if (txFilterSubcategory && tx._subcategory !== txFilterSubcategory) return false;
                              if (txFilterType === "income" && tx._isExpense) return false;
                              if (txFilterType === "expense" && !tx._isExpense) return false;
                              return true;
                            });
                            const total = filtered.reduce((sum: number, tx: any) => sum + (tx._isExpense ? -tx._parsedAmount : tx._parsedAmount), 0);
                            return (
                              <td key={header} className={`px-6 py-4 text-right font-mono border-t border-slate-200 whitespace-nowrap ${total >= 0 ? 'text-emerald-600' : 'text-slate-900'}`}>
                                ${Math.abs(total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </td>
                            );
                          }
                          return <td key={header} className="px-6 py-4 border-t border-slate-200"></td>;
                        })}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>
          </div>
        )}
      </main>
      {/* Budget Modal */}
      {isBudgetModalOpen && editingBudget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100">
              <h3 className="text-lg font-bold text-slate-900">Edit Budget</h3>
              <p className="text-sm text-slate-500 mt-1">Update monthly budget for {editingBudget.category}</p>
            </div>
            <div className="p-6 space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Monthly Average</label>
                  <div className="text-lg font-mono font-bold text-slate-700">
                    ${Math.round(editingBudget.unscaledAverage).toLocaleString()}
                  </div>
                </div>
                <div className="bg-slate-50 p-3 rounded-xl border border-slate-100">
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Monthly Budget</label>
                  <div className="text-lg font-mono font-bold text-slate-700">
                    ${Math.round(editingBudget.monthlyBudget).toLocaleString()}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase mb-2">New Monthly Budget</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-mono">$</span>
                  <input
                    type="number"
                    value={newBudgetValue}
                    onChange={(e) => setNewBudgetValue(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block pl-7 p-2.5 font-mono"
                    placeholder="0"
                  />
                </div>
              </div>

              <button
                onClick={() => {
                  const rounded = Math.round(editingBudget.unscaledAverage / 10) * 10;
                  setNewBudgetValue(rounded.toString());
                }}
                className="w-full py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold uppercase tracking-wider rounded-lg transition-colors flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-3 h-3" />
                Set to Monthly Average (Rounded to $10)
              </button>
            </div>
            <div className="p-6 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-3">
              <button
                onClick={() => setIsBudgetModalOpen(false)}
                className="px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-700 transition-colors uppercase tracking-wider"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateBudget}
                disabled={isUpdatingBudget}
                className="px-6 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold rounded-lg shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed uppercase tracking-wider"
              >
                {isUpdatingBudget ? "Updating..." : "OK"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Transaction Edit Modal */}
      {isTxModalOpen && editingTx && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-xl font-bold text-slate-900">Edit Transaction</h3>
              <button 
                onClick={() => setIsTxModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 space-y-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Amount</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-mono">$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={editTxAmount}
                    onChange={(e) => setEditTxAmount(e.target.value)}
                    onBlur={(e) => {
                      const val = parseFloat(e.target.value);
                      if (!isNaN(val)) {
                        setEditTxAmount(val.toFixed(2));
                      }
                    }}
                    className="w-full pl-8 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Category</label>
                <select
                  value={editTxCategory}
                  onChange={(e) => {
                    setEditTxCategory(e.target.value);
                    setEditTxSubcategory("");
                  }}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                >
                  {analysis.categories.map((cat: string) => (
                    <option key={cat} value={cat}>{cat}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Subcategory</label>
                <select
                  value={editTxSubcategory}
                  onChange={(e) => setEditTxSubcategory(e.target.value)}
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all"
                >
                  <option value="">None</option>
                  {modalSubcategories.map((sub: string) => (
                    <option key={sub} value={sub}>{sub}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="p-6 bg-slate-50 flex gap-3">
              <button
                onClick={() => setIsTxModalOpen(false)}
                className="flex-1 px-4 py-3 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-white transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleUpdateTransaction}
                disabled={isUpdatingTx}
                className="flex-1 px-4 py-3 bg-blue-600 text-white font-bold rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isUpdatingTx ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Saving...
                  </>
                ) : (
                  "OK"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <ImportModal 
        isOpen={isImportModalOpen} 
        onClose={() => setIsImportModalOpen(false)} 
        onImportComplete={() => {
          setIsImportModalOpen(false);
          fetchSheetData();
        }}
        getTokens={() => localStorage.getItem("google_tokens")}
      />
    </div>
  );
}
