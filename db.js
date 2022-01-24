import 'dotenv/config';

import mysql from 'mysql2/promise'

var connection = await mysql.createConnection({
    host     : process.env.MYSQL_HOST,
    user     : process.env.MYSQL_USERNAME,
    password : process.env.MYSQL_PASSWORD,
    database : process.env.MYSQL_DATABASE
  });
 
  /**
   * Create tables for storing data
   * 
   * 1. Users
   * 2. Students
   * 3. Attendance
   */
  await connection.query("CREATE TABLE IF NOT EXISTS `users` (`id` int AUTO_INCREMENT,`telegram_id` bigint,`group_id` varchar(255),`group_name` varchar(255),`name` varchar(255), PRIMARY KEY (id))");
  await connection.query("CREATE TABLE IF NOT EXISTS `students` (`id` bigint AUTO_INCREMENT,`telegram_id` bigint,`group_id` varchar(255),`group_name` varchar(255),`name` varchar(255), PRIMARY KEY (id))");
  await connection.query("CREATE TABLE IF NOT EXISTS `attendance` (`id` int AUTO_INCREMENT,`student_id` bigint,`type` varchar(255) DEFAULT 'present',`remarks` varchar(255),`created_at` datetime DEFAULT NOW(),`updated_at` datetime, PRIMARY KEY (id), FOREIGN KEY (`student_id`) REFERENCES `student_attendance_bot`.`students` (`id`) ON DELETE CASCADE)")
  await connection.query("CREATE TABLE IF NOT EXISTS `groups` (`id` int AUTO_INCREMENT,`group_id` bigint,`group_name` varchar(255), PRIMARY KEY (id))");

  export default {
      isStudentExist: async function(telegram_id, group_id) {
          const [rows, fields] = await connection.query({ sql: `SELECT * FROM students WHERE telegram_id = ? AND group_id = ?`, values: [telegram_id, group_id]})

          return rows.length;
      },
      getStudent: async function(telegram_id, group_id) {
        const [rows, fields] = await connection.query({ sql: `SELECT * FROM students WHERE telegram_id = ${telegram_id} AND group_id = ${group_id}`})

        return rows[0];
      },
      getStudentByTelegramID: async function(telegram_id) {
        const [rows, fields] = await connection.query({ sql: `SELECT * FROM students WHERE telegram_id = ${telegram_id}`})

        return rows && rows.length ? rows[0] : null;
      },
      createStudent: async function(data) {
        const [inserted] = await connection.query("INSERT INTO `students` SET ?", {telegram_id: data.telegram_id, group_id: data.group_id, group_name: data.group_name, name: data.name});
        console.log(inserted);
        return inserted;
      },
      updateStudent: async function(data) {
        const [studentsRows] = await connection.query("SELECT * FROM `students` WHERE telegram_id = ?", [data.telegram_id])

        if(studentsRows && studentsRows.length) {
          const student = studentsRows[0];
          try {
            await connection.query("UPDATE `students` SET ? WHERE telegram_id = ?", [{name: data.name}, data.telegram_id])
            return true;
          } catch (error) {
            throw error;
          }
        }
      },
      hasAttended: async function(data) {
        const telegram_id = data.telegram_id;
        const group_id = data.group_id;

        const studentExists = await this.isStudentExist(telegram_id, group_id);

        if(studentExists) {
            const student = await this.getStudent(telegram_id, group_id)

            if(student != null || student != undefined) {
                console.log(`Check ${student.name} has marked attendance on ${data.date}`);
                const [attendance] = await connection.query(`SELECT * FROM attendance WHERE student_id = ${student.id} AND CAST(created_at AS DATE) = ?`, [data.date])
    
                return attendance.length;
            }
        }

        return false;
      },
      markAttendance: async function(data) {
        const hasAttended = await this.hasAttended(data);

        const telegram_id = data.telegram_id;
        const group_id = data.group_id;

        const studentExists = await this.isStudentExist(telegram_id, group_id);

        if(studentExists) {
            if(!hasAttended) {
                const student = await this.getStudent(telegram_id, group_id)

                if(student != null || student != undefined) {
                    const attend = await connection.query("INSERT INTO `attendance` SET ?", {student_id: student.id, type: data.type})
    
                    return true;
                }
            }

            return "already attended";
        }

        return false;

      },
      updateAttendance: async function(data) {
        const telegram_id = data.telegram_id;
        const group_id = data.group_id;

        const studentExists = await this.isStudentExist(telegram_id, group_id);

        const hasAttended = await this.hasAttended(data);

        if(studentExists && hasAttended) {
            const student = await this.getStudent(telegram_id, group_id)
            const update = await connection.query("UPDATE attendance SET ?", {student_id: student.id, type: data.type, updated_at: data.date})

            return true;
        }

        return false;
      },
      getAttendance: async function(data) {
        const student = await this.getStudent(data.telegram_id, data.group_id)

        if(student != null || student != undefined) {
            const [attend] = await connection.query(`SELECT * FROM attendance WHERE student_id = ${student.id} AND CAST(created_at AS DATE) = ?`, [data.date])

            return attend && attend.length ? attend[0] : [];
        }
      },
      getAttendanceOfTheDay: async function(data) {
          const date = data.date;
          const type = data.type;
          const [rows] = await connection.query(`SELECT attendance.created_at, attendance.type, students.name FROM attendance RIGHT JOIN students ON students.id = attendance.student_id WHERE students.group_id = ? AND CAST(attendance.created_at AS DATE) = ? AND attendance.type = ? ORDER BY attendance.created_at`, [data.group_id, date, type])

          return rows;
      },
      getNotMarkedAttendanceOfTheDay: async function(data) {
          const [rows] = await connection.query('SELECT students.name, students.id FROM students WHERE students.id NOT IN (SELECT attendance.student_id from attendance WHERE CAST(attendance.created_at AS DATE) = ?) AND students.group_id = ?', [data.date, data.group_id])

          return rows;
      },
      isGroupRegistered: async function(group_id) {
          const [rows] = await connection.query("SELECT * FROM `groups` WHERE group_id = ?", [group_id]);

          return rows && rows.length;
      },
      registerGroup: async function(data) {
        const isRegistered = await this.isGroupRegistered(data.group_id);

        if(isRegistered) {
            return "group registration failed";
        }

        if(!isRegistered) {
            await connection.query("INSERT INTO `groups` SET ?", {group_id: data.group_id, group_name: data.group_name})
            return true;
        }

        return false;

      },
      getRegisteredGroups: async function() {
        const [groups] = await connection.query("SELECT * FROM `groups`");

        return groups;
      }
  };