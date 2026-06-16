import { Worker } from "bullmq";
import { db } from "../db/index.js";
import { jobsStateTable } from "../db/schema.js";
import { jobStatusEnumValues } from "../db/schema.js";
import { eq, inArray, sql } from "drizzle-orm";
import Docker from "dockerode"; 

const docker = new Docker(); 

function pullImage(image){
    return new Promise( async (res)=> {
        const stream = await docker.pull(image) 
        docker.modem.followProgress(stream, () => {
             res(); 
        }) 
    })
}


export const jobDispatchWorker = new Worker("job-dispatcher", async () => {
    console.log(`[job-dispatcher] : checking for new Submitted Jobs`);

    await db.transaction(async(tx) => {
        const stmt = sql `
        SELECT ${jobsStateTable.id } 
        FROM ${jobsStateTable}
        WHERE ${jobsStateTable.state} = ${jobStatusEnumValues[0]} 
        ORDER BY ${jobsStateTable.createdAt} ASC    
        FOR UPDATE SKIP LOCKED
        LIMIT 5; 
        `;

        const result = await tx.execute(stmt);
        const jobIds = result.rows.map((e) => e.id);

        console.log(`[job-dispatcher] : Found  ${jobIds.length} jobs in Submitted State : `, jobIds);
        
        // TODO : check if compute is available  

        if(jobIds.length > 0 ){
            console.log(`[job-dispatcher] : Moving ${jobIds.length} jobs in runnable State : `);

            await tx.update(jobsStateTable).set({
                state : jobStatusEnumValues[1]
            }).where(inArray(jobsStateTable.id, jobIds));
        }

    })
}, {
    connection : {
        host : "127.0.0.1",
        port : 6379,
    }
})

export const jobCriWorker = new Worker("job-cri", async () => {

    console.log(`[job-cri ] : checking for new Runnable Jobs`);

    await db.transaction(async(tx) => {
        const stmt = sql `
        SELECT ${jobsStateTable.id } 
        FROM ${jobsStateTable}
        WHERE ${jobsStateTable.state} = ${jobStatusEnumValues[1]} 
        ORDER BY ${jobsStateTable.createdAt} ASC    
        FOR UPDATE SKIP LOCKED
        LIMIT 1 ; 
        `;

        const result = await tx.execute(stmt);
        const jobIds = result.rows.map((e) => e.id);

        console.log(`[jobCriWorker] : Found  ${jobIds.length} jobs in Runnable State : `, jobIds);

        for(const jobId of jobIds){
            const [job]  =  await db.select().from(jobsStateTable).where(eq(jobsStateTable.id, jobId));
            const checkImageResult = await docker.listImages({filters: {
                reference : [`${job.image}:latest`],
            }})

            if(!checkImageResult || checkImageResult.length <= 0){
                console.log(`Pulling Image ${job.image}:latest`);
                await pullImage(`${job.image}:latest`);
            }

            const c = await docker.createContainer({
                Image : `${job.image}:latest`,
                Tty : false,
                Cmd : job.cmd,
                HostConfig : {
                    AutoRemove : false
                },
            })
            await c.start();
            console.log(`Container is Up and Running with ID : ${c.id}`);
            await tx.update(jobsStateTable).set({
                containerId : c.id, 
                state : jobStatusEnumValues[2]
            }).where(eq(jobsStateTable.id, jobId));
        }
    }, {
        accessMode : 'read write', 
        isolationLevel : "read committed"
    });
}, { 
    connection : {
        host : "127.0.0.1",
        port : 6379,
    }
})


export const jobWatcherWorker = new Worker("job-watch", async () => {
    console.log(`[job-watch] : checking for new Running Jobs`);

    await db.transaction(async(tx) => {
        const stmt = sql `
        SELECT ${jobsStateTable.id } 
        FROM ${jobsStateTable}
        WHERE ${jobsStateTable.state} = ${jobStatusEnumValues[2]} 
        ORDER BY ${jobsStateTable.createdAt} ASC    
        FOR UPDATE
        LIMIT 100 ; 
        `;

        const result = await tx.execute(stmt);
        const jobIds = result.rows.map((e) => e.id);

        for(const jobId of jobIds){
            const [job] = await db.select().from(jobsStateTable).where(eq(jobsStateTable.id,jobId));

            if(job.containerId){
                 const container = docker.getContainer(job.containerId);
                 const containerStatus = await container.inspect();
                 if(containerStatus.State.Status ===  'exited'){
                    await tx.update(jobsStateTable).set({
                        state : jobStatusEnumValues[4],
                        containerId : null,
                    }).where(eq(jobsStateTable.id,jobId));
                    await container.remove(); 
                 }
            }

        }

        console.log(`[job-watch] : Found  ${jobIds.length} jobs in Running State : `, jobIds);
    }, {
        accessMode : 'read write',  
        isolationLevel : "read committed"
    });
}, {
    connection : {
        host : "127.0.0.1",
        port : 6379,
    }
})    
