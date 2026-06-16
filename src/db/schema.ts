import {pgTable, uuid, timestamp, text, pgEnum } from "drizzle-orm/pg-core"

//todo add zod for config


export const jobStatusEnum = pgEnum("job_status_enum", [
    "SUBMITTED",
    "RUNNABLE",
    "RUNNING",
    "FAILED",
    "SUCCEEDED",
]);

export const jobStatusEnumValues = jobStatusEnum.enumValues;

export const jobsStateTable = pgTable("jobs",{
    id: uuid("id").primaryKey().defaultRandom(),

    image: text().notNull(),
    cmd: text().default(null),
    containerId: text('container_id'),

    state : jobStatusEnum().notNull().default("SUBMITTED"),
    
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").$onUpdate(() => new Date()),
})
