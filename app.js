import { Telegraf, Markup } from 'telegraf';
import db from './db.js'
import moment from 'moment'
import cron from 'node-cron'

const bot = new Telegraf(process.env.BOT_TOKEN)

bot.start(ctx => {
    const username = ctx.message.from.username;
    const chatType = ctx.message.chat.type;

    if (chatType == 'private') {
        ctx.reply(`Hello ${username}, thank you for using me!`)
    } else if (chatType == 'group') {
        const groupName = ctx.message.chat.title;
        ctx.reply(`Hello ${username}, welcome to ${groupName} group!`)
    }
});

bot.hears(['Assalamu Alaikum', 'assalamu alaikum', 'Assalamu alaikum'], ctx => {
    ctx.reply('Wa alaikumussalam');
})

bot.command('register_admin', ctx => {
    // Only proceed if the command is from a group
    // Check the sender is an admin

})

bot.command('attendance_today', async ctx => {
    if (ctx.message.chat.type != 'group') {
        return;
    }

    const group_id = ctx.message.chat.id;
    const date = moment.unix(ctx.message.date).format('YYYY-MM-DD');
    const present = await db.getAttendanceOfTheDay({ group_id, date, type: 'present' })
    console.log('Present: \n', present);

    let message;
    let count = 1;

    if (present && present.length) {
        message = `<b>Present today:</b> \n\n`;
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

    if(message) {
        ctx.replyWithHTML(message);
    }

})

bot.command('test', ctx => {
    // ctx.replyWithHTML("<b>OhH! You were testing!</b>", Markup.inlineKeyboard([ Markup.button.callback('Present', '/in'), Markup.button.callback('Absent', '/out') ]));
    return ctx.reply('Oh You are testing with inline keyboard', Markup.inlineKeyboard([Markup.button.callback('Present', 'present'), Markup.button.callback('Absent', 'absent')]).oneTime().resize())
})

bot.action('present', attendanceCB)
bot.action('absent', attendanceCB)

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

async function attendance(ctx) {
   
    // check the sender alreay in the students table
    // insert one if not exists
    // add attendance for today if not done today
    const chatType = ctx.message.chat.type;

    console.log("Chat type should be group:", chatType);

    if (chatType != 'group') {
        return;
    }

    /**
     * Attendance should be between 6:30 - 9:00 
     */

    const telegram_id = ctx.message.from.id;
    const group_id = ctx.message.chat.id;
    const name = ctx.message.from.username;
    const group_name = ctx.message.chat.title
    const message_time = moment.unix(ctx.message.date)
    const start_time = moment().set({hour: process.env.START_HOUR, minute: process.env.START_MINUTE})
    const end_time = moment().set({hour: process.env.END_HOUR, minute: process.env.END_MINUTE})

    // if its between 6:30 & 9:00
    if (!message_time.isAfter(start_time) || !message_time.isBefore(end_time)) {
        ctx.reply(`[${message_time.format('DD-MM-YYYY hh:mm:ss a')}] The attendance facility is not available now. 
        Please try again between ${start_time.format('hh:mm a')} and ${end_time.format('hh:mm a')}`)
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

    const command = ctx.message.text;
    const data = {
        telegram_id,
        group_id,
        type: command == '/in' ? 'present' : 'leave',
        date: moment.unix(ctx.message.date).format('YYYY-MM-DD')
    }

    if (command == '/out') {
        ctx.telegram.sendMessage(ctx.message.from.id, 'Hey! are you on leave today?')
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
        const time = moment.unix(ctx.message.date).format('hh:mm:ss a')
        ctx.reply(`${name} has marked attendance on ${time}`)
    }

    if (attendanceMarked == 'already attended') {
        const attendance = await db.getAttendance(data)

        if ((command == '/out' && attendance.type == 'present') || (command == '/in' && attendance.type == 'absent')) {
            data.date = moment.unix(ctx.message.date).format('YYYY-MM-DD HH:mm:ss');
            const time = moment.unix(ctx.message.date).format('hh:mm:ss a')
            await db.updateAttendance(data);
            ctx.reply(`${name} has updated attendance on ${time}`)
        } else {
            ctx.reply(`${name} has already marked attendance on ${moment(attendance.updated_at ? attendance.updated_at : attendance.created_at).format('hh:mm:ss A')}`)
        }

    }
}

async function attendanceCB(ctx) {
   
    // check the sender alreay in the students table
    // insert one if not exists
    // add attendance for today if not done today
    const chatType = ctx.chat.type;

    console.log("Chat type should be group:", chatType);

    if (chatType != 'group') {
        return;
    }

    /**
     * Attendance should be between 6:30 - 9:00 
     */
    const msg = ctx.update.callback_query;
    const telegram_id = msg.from.id;
    const group_id = msg.message.chat.id;
    const name = msg.from.username;
    const group_name = msg.message.chat.title
    const message_time = moment.unix(msg.message.date)
    const start_time = moment().set({hour: process.env.START_HOUR, minute: process.env.START_MINUTE})
    const end_time = moment().set({hour: process.env.END_HOUR, minute: process.env.END_MINUTE})

    // if its between 6:30 & 9:00
    if (!message_time.isAfter(start_time) || !message_time.isBefore(end_time)) {
        ctx.reply(`[${message_time.format('DD-MM-YYYY hh:mm:ss a')}] The attendance facility is not available now. 
        Please try again between ${start_time.format('hh:mm a')} and ${end_time.format('hh:mm a')}`)
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

    const command = msg.message.text;
    const data = {
        telegram_id,
        group_id,
        type: command == '/in' ? 'present' : 'leave',
        date: moment.unix(msg.message.date).format('YYYY-MM-DD')
    }

    if (command == '/out') {
        ctx.telegram.sendMessage(msg.message.from.id, 'Hey! are you on leave today?')
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
        const time = moment.unix(ctx.message.date).format('hh:mm:ss a')
        ctx.reply(`${name} has marked attendance on ${time}`)
    }

    if (attendanceMarked == 'already attended') {
        const attendance = await db.getAttendance(data)

        if ((command == '/out' && attendance.type == 'present') || (command == '/in' && attendance.type == 'absent')) {
            data.date = moment.unix(ctx.message.date).format('YYYY-MM-DD HH:mm:ss');
            const time = moment.unix(ctx.message.date).format('hh:mm:ss a')
            await db.updateAttendance(data);
            ctx.reply(`${name} has updated attendance on ${time}`)
        } else {
            ctx.reply(`${name} has already marked attendance on ${moment(attendance.updated_at ? attendance.updated_at : attendance.created_at).format('hh:mm:ss A')}`)
        }

    }
}

async function sheduleAttendence() {
    console.log("The scheduler has started");

    console.log("checking for registered groups");

    const groups = await db.getRegisteredGroups()
    console.log(groups);

    cron.schedule('* 30 6 * * *', () => {
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
                let message = `<b>${date}</b>\n`;
                message += `അസ്സലാമു അലൈകും,\nപ്രിയപ്പെട്ട വിദ്യാർത്ഥികളെ, സുഖം തന്നെയല്ലേ?`
                message += `\n<b>ഹാജർ പറയൂ</b>`
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
    })

    cron.schedule('* 0 9 * * *', () => {
        if(groups && groups.length) {
            groups.forEach(async group => {
                const group_id = group.group_id;
                const date = moment().format('YYYY-MM-DD');
                const present = await db.getAttendanceOfTheDay({ group_id, date, type: 'present' })
                console.log('Present: \n', present);
        
                let message;
                let count = 1;
        
                if (present && present.length) {
                    message = `<b>Present today:</b> \n\n`;
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

                if(message) {
                    bot.telegram.sendMessage(group_id, message, {parse_mode: 'HTML'});
                }
        
            })
        }
    })
}

sheduleAttendence()

bot.launch()

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'))
process.once('SIGTERM', () => bot.stop('SIGTERM'))