import { Telegraf, Markup, Scenes, session } from 'telegraf';
import db from './db.js'
import moment from 'moment'
import cron from 'node-cron'
import { exec } from 'child_process'
import changeEnv from './env.js'

const bot = new Telegraf(process.env.BOT_TOKEN)
const ktmTelID = 1200098668;

/**
 * Configure wizrads
 * 1. env-change wizard
 */
 const envChangeWizard = new Scenes.WizardScene(
    'env-wizard', 
    (ctx) => {
        ctx.reply('Enter the key:');
        
        // save the request user
        ctx.scene.session.user_id = ctx.from.id;
        ctx.scene.session.env = {};

        return ctx.wizard.next()
    },
    (ctx) => {
        const key = ctx.message.text;

        if(!key) {
            return ctx.reply('Please enter a valid key')
        }

        ctx.scene.session.env.key = key;
        ctx.reply('Enter the value:');

        return ctx.wizard.next();
    },
    async (ctx) => {
        const key = ctx.scene.session.env.key;
        const value = ctx.message.text;
        const user = ctx.scene.session.user_id;

        if(isKtm(ctx)) {
           updateEnv(key, value, user);
            ctx.reply(`.env file has been updated!`);
        } else {
            ctx.reply("Sorry! You don't sufficiant permission to do that!");
        }
        return ctx.scene.leave();
    }
)

const studentNameChangeWizard = new Scenes.WizardScene(
    'student-name-wizard', 
    async ctx => {
        const telegram_id = ctx.message.from.id;
        const student = await db.getStudentByTelegramID(telegram_id);

        if(!student || student == null || student == undefined) {
            ctx.reply(`Sorry! your data is not stored in our database`);
            return ctx.scene.leave();
        }

        await ctx.reply(`Hi! ${student.name}, do you want to change your name?`, {
            ...Markup.keyboard([
                Markup.button.text('Yes'),
                Markup.button.text('No')
            ])
        });

        ctx.scene.session.user = {};

        return ctx.wizard.next()
    },
    ctx => {
        const confirmation = ctx.message.text;

        console.log("user entered", confirmation);

        const options = ['Yes', 'No']

        if(!options.includes(confirmation)) {
            ctx.reply("Please select Yes or No!");
        }

        if(confirmation == 'No') {
            ctx.reply("You have cancelled the operation! If you want to change your name again, please send me /change_my_name", {reply_markup: { remove_keyboard: true }})
            ctx.scene.leave();
        }

        if(confirmation == 'Yes') {
            ctx.reply("Enter your new name:", {reply_markup: { remove_keyboard: true }});
            return ctx.wizard.next()
        }

    },  
    async ctx => {
        const telegram_id = ctx.message.from.id;
        const name = ctx.message.text;

        if(!name) {
            ctx.reply('Please enter a valid name!')
        }

        const updated = await db.updateStudent({telegram_id, name})

        if(updated) {
            ctx.reply(`Hey ${name}, Your name has been updated!`)
            ctx.scene.leave();
        }
    }

)
/**
* Setting up wizards
*/
const stage = new Scenes.Stage([envChangeWizard, studentNameChangeWizard])

/**
 * Register middlewares
 * 
 */
bot.use((ctx, next) => {
    const debug = JSON.parse(process.env.BOT_DEBUG);

    if(debug == true && !isKtm(ctx)) {
        return;
    }

    next()
})
 bot.use(session())
 bot.use(stage.middleware())

 /////////////////////////////////////////////

bot.start(ctx => {
    const username = ctx.message.from.username ? ctx.message.from.username : (ctx.message.from.first_name ? ctx.message.from.first_name : 'No name');
    const chatType = ctx.message.chat.type;

    if (chatType == 'private') {
        ctx.reply(`Hello ${username}, thank you for using me!`)
    } else if (chatType == 'group') {
        const groupName = ctx.message.chat.title;
        ctx.reply(`Hello ${username}, welcome to ${groupName} group!`)
    }
});

bot.command('my_name', async ctx => {
    const telegram_id = ctx.message.from.id;
    const student = await db.getStudentByTelegramID(telegram_id);

    let username = ctx.message.from.username ? ctx.message.from.username : (ctx.message.from.first_name ? ctx.message.from.first_name : 'No name');
    
    if(student) {
        username = student.name;
    }

    ctx.reply(`Hey! You are ${username}`);
})

bot.command('/change_my_name', async ctx => {
    const chatType = ctx.message.chat.type;

    const student = await db.getStudentByTelegramID(ctx.from.id);

    if(!student) {
        ctx.reply('Sorry! you are not registered with us!');
        return;
    }

    if(chatType != 'private') {
        ctx.telegram.sendMessage(ctx.message.from.id, `Hey! ${student.name} is your current name. Do you want to change? Click here: /change_my_name`);
        ctx.deleteMessage();
        return;
    }


    ctx.scene.enter('student-name-wizard')
})

bot.hears(['Assalamu Alaikum', 'assalamu alaikum', 'Assalamu alaikum'], ctx => {
    ctx.reply('Wa alaikumussalam');
})

bot.hears(['hi', 'Hi'], ctx => ctx.reply('Hiii!'))

bot.command('settings', ctx => {
    ctx.reply(`Start Hour: ${process.env.START_HOUR}\nStart Minute: ${process.env.START_MINUTE}`)
})


bot.command('attendance_today', async ctx => {
    if (ctx.message.chat.type != 'group') {
        return;
    }

    const group_id = ctx.message.chat.id;
    await sendAttendanceOfTheDay(group_id);

})

bot.command('test', ctx => {
    // ctx.replyWithHTML("<b>OhH! You were testing!</b>", Markup.inlineKeyboard([ Markup.button.callback('Present', '/in'), Markup.button.callback('Absent', '/out') ]));
    return ctx.reply('Oh You are testing with inline keyboard', Markup.inlineKeyboard([Markup.button.callback('Present', 'present'), Markup.button.callback('Absent', 'absent')]).oneTime().resize())
})

bot.command('time', ctx => {
    const now = moment().format('DD-MM-YYYY hh:mm:ss A')
    ctx.reply(now)
})

bot.action('present', (ctx) => {
    attendance(ctx, true)
})

bot.action('absent', (ctx) => {
    attendance(ctx, true)
})


/**
 * ADMIN ONLY COMMANDS
 */
bot.command('send_morning_reminder', ctx => sendAttendanceReminder())

bot.command('change_env', ctx => {
    const ktm = ctx.message.from.id;

    if(isKtm(ctx)) {
        ctx.scene.enter('env-wizard')
    }
})

bot.command('restart', ctx => restartApp())


function isKtm(ctx) {
    const ktmsulaim = ctx.from.username;

    return ktmsulaim == 'ktmsulaim';
}


bot.command('register_group', async ctx => {
    const group_id = ctx.message.chat.id;
    const group_name = ctx.message.chat.title;

    const registered = await db.registerGroup({ group_id, group_name })

    if (registered == 'group registration failed') {
        ctx.reply('The group was already registered!');
    }

    if (registered == true) {
        ctx.reply(`The group ${group_name} was successfully registered`);
    }

    if (registered == false) {
        ctx.reply('Unable to register the group!');
    }
})



bot.command(['in', 'out'], attendance)

async function attendance(ctx, callback = false) {
    let message;

    if (callback == true) {
        message = ctx.update.callback_query.message;
    } else {
        message = ctx.message;
    }

    // check the sender alreay in the students table
    // insert one if not exists
    // add attendance for today if not done today
    const chatType = message.chat.type;

    console.log("Chat type should be group:", chatType);

    if (chatType != 'group') {
        return;
    }

    /**
     * Attendance should be between 6:30 - 9:00 
     */
    
    let telegram_id = message.from.id;
    let name = message.from.username ? message.from.username : (message.from.first_name ? message.from.first_name : 'No name');
    
    if(callback == true) {
        const from = ctx.update.callback_query.from;
        telegram_id = from.id;
        name = from.username ? from.username : (from.first_name ? from.first_name : `${telegram_id}`);
    }

    const group_id = message.chat.id;
    const group_name = message.chat.title
    const message_time = moment()
    const start_time = moment().set({ hour: process.env.START_HOUR, minute: process.env.START_MINUTE })
    const end_time = moment().set({ hour: process.env.END_HOUR, minute: process.env.END_MINUTE })
    let command = message.text;

    // check is group registered
    const isGroupRegistered = await db.isGroupRegistered(group_id);

    if(!isGroupRegistered) {
        return;
    }

    if(callback == true) {
        const matched = ctx.match[0];

        if(matched) {
            command = matched == 'present' ? '/in' : (matched == 'absent' ? '/out' : '/in');
        }
    }

    // Check whether the admin is marking attendance
    const isSenderAdmin = await isAdmin(ctx, callback)

    console.log("Sender is admin: ", isSenderAdmin);

    if (isSenderAdmin) {
        ctx.telegram.sendMessage(telegram_id, `You are trying to mark ${command == '/in' ? 'presence' : (command == '/out' ? 'absence' : command)} on ${group_name} group. But you're an admin!`);
        return;
    }

    // if its between 6:30 & 9:00
    if (!message_time.isSameOrAfter(start_time) || !message_time.isBefore(end_time)) {
        ctx.reply(`[${message_time.format('DD-MM-YYYY hh:mm:ss a')}] The attendance facility is not available now. Please try again between ${start_time.format('hh:mm a')} and ${end_time.format('hh:mm a')}`)
        // ctx.reply('Hmm! attendance facility is not available now. Please try again between 6:30 am and 9:00 am')
        return;
    }

    // check is holiday or any holi dates
    const holiday = process.env.HOLI_DAY
    const today = moment()
    let holidates = process.env.HOLI_DATES;
    holidates = holidates ? JSON.parse(holidates) : []

    if (today.format('dddd') == holiday || holidates.includes(today.format('DD-MM-YYYY'))) {
        ctx.reply('Ooh! Are you going to mark the attendance on holiday?');
        return;
    }


    console.log("Checking whether a student is registered with telegram id and group id");
    const studentExists = await db.isStudentExist(telegram_id, group_id);
    console.log("The student is :", studentExists);

    if (!studentExists) {
        const studentData = {
            group_id,
            telegram_id,
            name,
            group_name,
        }

        console.log(`A new student is being created: ${name}, Telegram ID: ${telegram_id}, Group: ${group_name} (${group_id})`);

        await db.createStudent(studentData);
        console.log("A new student was created!");
    }


    const data = {
        telegram_id,
        group_id,
        type: command == '/in' ? 'present' : 'leave',
        date: moment.unix(message.date).format('YYYY-MM-DD')
    }

    if (command == '/out') {
        ctx.telegram.sendMessage(telegram_id, 'Hey! are you on leave today?')
        console.log(`${name} is leave on today`);
    }

    console.log("Checking the student has attended today");

    const attendanceMarked = await db.markAttendance(data)

    if (!attendanceMarked) {
        console.log("Unable to mark the attendance");
        ctx.reply(`Sorry ${name}, there was an error while marking your attendance!`)
    }

    if (attendanceMarked == true) {
        console.log("The attendance was marked");
        const time = moment.unix(message.date).format('hh:mm:ss a')
        ctx.reply(`${name} has marked attendance on ${time}`)
    }

    if (attendanceMarked == 'already attended') {
        const attendance = await db.getAttendance(data)

        console.log(command);

        if ((command == '/out' && attendance.type == 'present') || (command == '/in' && attendance.type == 'absent')) {
            data.date = moment.unix(message.date).format('YYYY-MM-DD HH:mm:ss');
            const time = moment.unix(message.date).format('hh:mm:ss a')
            await db.updateAttendance(data);
            ctx.reply(`${name} has updated attendance on ${time}`)
        } else {
            ctx.reply(`${name} has already marked attendance on ${moment(attendance.updated_at ? attendance.updated_at : attendance.created_at).format('hh:mm:ss A')}`)
        }

    }
}

async function sheduleAttendence() {
    console.log("The scheduler has started");

    const start_hour = process.env.START_HOUR ? process.env.START_HOUR : 6;
    const start_minute = process.env.START_MINUTE ? process.env.START_MINUTE : 30;
    
    const end_hour = process.env.END_HOUR ? process.env.END_HOUR : 9;
    const end_minute = process.env.END_MINUTE ? process.env.END_MINUTE : 0;

    cron.schedule(`0 ${start_minute} ${start_hour} * * *`, sendAttendanceReminder, { scheduled: true, timezone: 'Asia/Kolkata' })

    cron.schedule(`0 ${end_minute} ${end_hour} * * *`, async () => {
        console.log("Checking for groups");
        const groups = await db.getRegisteredGroups()
        console.log("Found groups:", groups.length);

        if (groups && groups.length) {
            groups.forEach(async group => {
                bot.telegram.sendMessage(group.group_id, "<b>Attendance time out!!!</b>", { parse_mode: 'HTML' })
                await sendAttendanceOfTheDay(group.group_id);
            })
        }
    }, {
        scheduled: true,
        timezone: 'Asia/Kolkata'
    })
}

sheduleAttendence()

async function sendAttendanceReminder() {
    console.log("checking for registered groups");

    const groups = await db.getRegisteredGroups()
    console.log(groups);
    // check is holiday or any holi dates
    const holiday = process.env.HOLI_DAY
    const today = moment()
    let holidates = process.env.HOLI_DATES;
    holidates = holidates ? JSON.parse(holidates) : []

    if (today.format('dddd') == holiday || holidates.includes(today.format('DD-MM-YYYY'))) {
        return;
    }
    if (groups && groups.length) {
        console.log(`Total groups ${groups.length}`);
        groups.forEach(group => {
            const date = moment().format('DD-MM-YYYY')
            const start_time = moment().set({ hour: process.env.START_HOUR, minute: process.env.START_MINUTE })
            const end_time = moment().set({ hour: process.env.END_HOUR, minute: process.env.END_MINUTE })
            
            let message = `<b>${date}</b>\n\n`;
            message += `അസ്സലാമു അലൈകും,\nപ്രിയപ്പെട്ട വിദ്യാർത്ഥികളെ, സുഖം തന്നെയല്ലേ?`
            message += `\n<b>ഹാജർ പറയൂ</b>`;
            message += `\n\nAttendance Timing: ${start_time.format('hh:mm A')} - ${end_time.format('hh:mm A')}`;

            bot.telegram.sendMessage(group.group_id, message, {
                parse_mode: 'HTML',
                ...Markup.inlineKeyboard([
                    Markup.button.callback('Present', 'present'),
                    Markup.button.callback('Absent', 'absent')
                ])
            })
        })
        console.log("Messages were sent to each groups");
    }
}

async function sendAttendanceOfTheDay(group_id, dateToGet = null) {
    // check is group registered
    console.log("Checking whether group is registered, group ID:", group_id);
    const isGroupRegistered = await db.isGroupRegistered(group_id);

    if(!isGroupRegistered) {
        console.log("Group is not registered");
        return;
    }

    console.log("Group registered, continueing");


    let date = moment().format('YYYY-MM-DD');

    if(dateToGet && moment(dateToGet).isValid()) {
        date = moment(dateToGet).format('YYYY-MM-DD');
    }

    const present = await db.getAttendanceOfTheDay({ group_id, date, type: 'present' })
    console.log('Present: \n', present);

    let message = "<b>Attendance Report</b>";
    let count = 1;

    if (present && present.length) {
        message = `\n\n<b>Present today:</b> \n\n`;
        present.forEach((atd) => {
            message += `${count}. ${atd.name} - ${moment(atd.created_at).format('hh:mm:ss a')} \n`;

            count++;
        })
    }

    const absent = await db.getAttendanceOfTheDay({ group_id, date, type: 'absent' })
    console.log('Absent: \n', absent);
    count = 1;

    if (absent && absent.length) {
        message += `\n\n<b>Absent today:</b> \n\n`;
        let count = 1;
        absent.forEach((atd) => {
            message += `${count}. ${atd.name} \n`;

            count++;
        })
    }

    const notMarkedAttendance = await db.getNotMarkedAttendanceOfTheDay({ date, group_id })
    count = 1;
    console.log('Not marked: \n', notMarkedAttendance);

    if (notMarkedAttendance && notMarkedAttendance.length) {
        message += `\n\n<b>Not marked attendance:</b>\n\n`;

        notMarkedAttendance.forEach(ntd => {
            message += `${count}. ${ntd.name} \n`;

            count++;
        })
    }

    if (message) {
        bot.telegram.sendMessage(group_id, message, { parse_mode: 'HTML' });
    }

}

// update env and restart the server
function updateEnv(key, value, ktm) {
    console.log(key, value, ktm);
    if (key) {
        
        changeEnv(key, value);

        if(ktm) {
            const now = moment().format('DD-MM-YYYY hh:mm:ss a')
            bot.telegram.sendMessage(ktm, `[${now}]\nThe env file has been changed and the pm2 restarted the app.js. Configuration: ${key}=${value}.`)
        }

        restartApp()
    }
}

async function isAdmin(ctx, callback = false) {
    let message;

    if (callback == true) {
        message = ctx.update.callback_query.message;
    } else {
        message = ctx.message;
    }

    let sender = message.from.id;

    if(callback == true) {
        sender = ctx.update.callback_query.from.id;
    }

    const adminUsers = await bot.telegram.getChatAdministrators(message.chat.id);

    if (adminUsers && adminUsers.length) {
        const adminUserIds = adminUsers.map(admin => admin.user.id);

        return adminUserIds.includes(sender);
    }
    return false;
}

function restartApp() {
    exec('pm2 restart app.js', (error, stdout, stderr) => {
        const now = moment().format("DD-MM-YYYY hh:mm:ss A")
        bot.telegram.sendMessage(ktmTelID, "The system has restarted on " + now);
        if (error) {
            console.log(`error: ${error.message}`);
            return;
        }
        if (stderr) {
            console.log(`stderr: ${stderr}`);
            return;
        }
        console.log(`stdout: ${stdout}`);
    })
}

/**
 * Error handling
 */
bot.catch((err, ctx) => {
    restartApp();
    bot.telegram.sendMessage(ktmTelID, `Bot error: ${err}`)
})

/**
 * LAUNCH
 */
bot.launch()

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))