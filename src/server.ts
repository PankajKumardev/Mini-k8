import express from "express";
import dotenv from "dotenv";
import { db } from "./db/index.js";
import { jobsStateTable } from "./db/schema.js";

dotenv.config();

const app = express();

app.use(express.json());

app.get("/", (req, res) => {
    res.send("Server is running");
});

app.post('/job', async (req, res) => {
    const {image, cmd = null} = req.body;
    if(!image) {
        res.status(400).json({error: "Image is required"});
        return;
    }
    const [insertedResult] =  await db
    .insert(jobsStateTable)
    .values({image, cmd})
    .returning({
        id: jobsStateTable.id,
    });

    res.status(201).json({
        jobId: insertedResult.id ,
    }); 
})

app.listen(process.env.PORT || 8000, () => {
    console.log(`Server is running on port ${process.env.PORT || 8000}`);
});
