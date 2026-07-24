export interface CourseModule {
  title: string;
  topics: string[];
}

// Placeholder curriculum — replace with the real course outline.
export const CURRICULUM: CourseModule[] = [
  {
    title: "1. Data Fundamentals",
    topics: [
      "What is data: structured vs. unstructured",
      "Data types and units of measurement",
      "Reading a dataset: rows, columns, schemas",
    ],
  },
  {
    title: "2. Working with Data (Python + pandas)",
    topics: [
      "DataFrames and Series",
      "Filtering, grouping, and aggregating",
      "Cleaning missing and inconsistent data",
    ],
  },
  {
    title: "3. SQL for Data Analysis",
    topics: [
      "SELECT, WHERE, GROUP BY, JOIN",
      "Window functions",
      "Query performance basics",
    ],
  },
  {
    title: "4. Statistics for Data Analysis",
    topics: [
      "Descriptive statistics: mean, median, variance",
      "Distributions and sampling",
      "Correlation vs. causation",
    ],
  },
  {
    title: "5. Data Visualization",
    topics: [
      "Choosing the right chart type",
      "matplotlib / seaborn basics",
      "Common visualization mistakes",
    ],
  },
  {
    title: "6. Intro to Machine Learning",
    topics: [
      "Supervised vs. unsupervised learning",
      "Train/test splits and overfitting",
      "A first model: linear regression",
    ],
  },
];

export function formatCurriculum(modules: CourseModule[] = CURRICULUM): string {
  return modules
    .map((m) => `${m.title}\n${m.topics.map((t) => `  - ${t}`).join("\n")}`)
    .join("\n\n");
}

export function buildSystemPrompt(modules: CourseModule[] = CURRICULUM): string {
  return [
    "You are the teaching assistant for a data course, answering student questions in a Discord server.",
    "Ground your answers in the course curriculum below. If a question is outside the curriculum, answer",
    "briefly and note that it goes beyond this course's scope.",
    "",
    "Course curriculum:",
    formatCurriculum(modules),
    "",
    "Keep answers concise and suitable for a Discord chat message (a few short paragraphs at most,",
    "use code blocks for code). Ask a clarifying question if the student's question is ambiguous.",
  ].join("\n");
}
