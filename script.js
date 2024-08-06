class Person {
    constructor(name) {
        this.name = name;
        this.shifts = [];
        this.points = 0;
    }
}

class Shift {
    constructor(name, type, day) {
        this.person = name;
        this.type = type;
        this.day = day;
    }
}

/* Treat as enum */
class ShiftTypes {
    constructor() { throw new Error("Cannot create instance of this class."); }
    static ON_CALL_WKDAY = "OnCall-Weekday";
    static ON_CALL_WKEND = "OnCall-Weekend";
    static OFFICE_HOURS = "Office Hours";
}
Object.freeze(ShiftTypes);

/* Treat as enum */
class Availabilities {
    constructor() { throw new Error("Cannot create instance of this class."); }
    static PREFERRED = "Preferred";
    static NOT_PREFERRED = "Not Preferred";
    static NOT_AVAILABLE = "Not Available";
}
Object.freeze(Availabilities);


/**
 * Processes an uploaded .csv file.
 * 
 * @param {File} file The .csv file to read.
 * @returns {Promise<Array<Array<string>>>} A promise that resolves to a 2D array of strings if successful, representing the data contained in the file.
 * @throws {Error} - Throws an error if the file cannot be read for whatever reason.
 */
function handleInputCSV(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = function(e) {
            let csvContent = e.target.result;
            
            // Normalize CRLF and CR row delimiters to LF (\n)
            csvContent = csvContent.replace(/\r\n?/g, '\n');
            const lines = csvContent.split('\n');
            const n = lines.length;
            
            // Remove empty last row if exists
            if (n > 1 && lines[n - 1] === '') { lines.pop(); }
            resolve(lines.map(line => line.split(',')));
        };
        
        reader.onerror = function(e) {
            reject(new Error('File could not be read: ' + e.target.error));
        };
        
        reader.readAsText(file);
    });
}


/**
 * Reads inputs from the HTML inputs on the website.
 * 
 * @returns {Object} A JS object with problem requirements as properties.
 */
function gatherRequirements() {
    const numOnCallSunToWed = document.getElementById('Sun-Wed');
    const numOnCallThurs = document.getElementById('Thurs');
    const numOnCallFriToSat = document.getElementById('Fri-Sat');
    const daysInMonth = document.getElementById('num-days');
    const firstDayOfMonth = document.getElementById('first-day-of-month');
    const requirements = {
        numDons: {
            onCallSunToWed: parseInt(numOnCallSunToWed.value || numOnCallSunToWed.placeholder),
            onCallThurs: parseInt(numOnCallThurs.value || numOnCallThurs.placeholder),
            onCallFriToSat: parseInt(numOnCallFriToSat.value || numOnCallFriToSat.placeholder),
        },
        points: {
            onCallWeekday: 1,
            onCallWeekend: 2,
        },
        monthInfo: {
            days: parseInt(daysInMonth.value),
            firstDay: parseInt(firstDayOfMonth.value),
            numWeekends: null,      // FRI and SAT nights
            numWeekdays: null,
            numThurs: null,
            numWeekdaysNotThurs: null,
        }
    };

    // Fill in monthInfo subObject with calculated values 
    const monthSubObj = requirements.monthInfo;
    (function() {
        const daysAfterFirstWk = monthSubObj.days - 7 + monthSubObj.firstDay;
        const daysInLastWk = daysAfterFirstWk % 7;
        const fullWeeksAfterFirst = Math.floor(daysAfterFirstWk/7);

        if (monthSubObj.firstDay === 6) {       // First day is SAT
            if (daysInLastWk > 4) {         
                monthSubObj.numWeekends = 1 + fullWeeksAfterFirst*2 + (daysInLastWk > 5 ? daysInLastWk-5 : 0);
            } else {        // No weekends in last week
                monthSubObj.numWeekends = 1 + fullWeeksAfterFirst*2;
            }
        } else {
            if (daysInLastWk > 4) {     
                monthSubObj.numWeekends = 2 + fullWeeksAfterFirst*2 + (daysInLastWk > 5 ? daysInLastWk-5 : 0);
            } else {
                monthSubObj.numWeekends = 2 + fullWeeksAfterFirst*2;
            }
        }

        if (monthSubObj.firstDay > 4) {
            if (daysInLastWk > 4) {
                monthSubObj.numThurs = fullWeeksAfterFirst + 1;
            } else {
                monthSubObj.numThurs = fullWeeksAfterFirst;
            }
        } else {
            if (daysInLastWk > 4) {
                monthSubObj.numThurs = 1 + fullWeeksAfterFirst + 1;
            } else {
                monthSubObj.numThurs = 1 + fullWeeksAfterFirst;
            }
        }
    })();
    monthSubObj.numWeekdays = monthSubObj.days - monthSubObj.numWeekends;
    monthSubObj.numWeekdaysNotThurs = monthSubObj.numWeekdays - monthSubObj.numThurs;

    return requirements;
}


/**
 * Generates a schedule based on people available and requirements.
 * 
 * @param {Array<Person>} people Array of `Person` objects, where each object has a person's Shifts and points.
 * @param {Array<Array<string>>} availabilities 2D array of strings representing the availability of each person.
 * @param {Object} reqs Custom object containing various scheduling requirements and constraints.
 * @returns {Array<Array<Shift>>} The generated schedule, where the first element is null and day 1 starts on index 1.
 */
function assignShifts(people, avails, reqs) {
    // Set up schedule
    const schedule = [null];
    for (let day = 1; day <= reqs.monthInfo.days; day++) {
        schedule.push([]);
    }
    
    // Constraints and specifications
    const totalPointBudget = (reqs.monthInfo.numWeekdaysNotThurs*reqs.numDons.onCallSunToWed + reqs.monthInfo.numThurs*reqs.numDons.onCallThurs)*reqs.points.onCallWeekday 
                                + reqs.monthInfo.numWeekends*reqs.numDons.onCallFriToSat*reqs.points.onCallWeekend;
    const pointsPerPerson = Math.floor(totalPointBudget / people.length);
    let totalPoints = 0;
    console.log(`total: ${totalPointBudget}, pts per pers: ${pointsPerPerson}`);
    
    // Rank people based on least to most # of preferred days
    const sortedDonPrefs = genSortedDonPrefs(people, avails, reqs);
    console.log(sortedDonPrefs);
    
    
    /* Initially Assign On-Call Shifts */       // Works but can leave holes in schedule
    // Assign X to night Y if X must work this night to meet reqs due to availabilities
    let currDay = reqs.monthInfo.firstDay;
    for (let day = 1; day <= reqs.monthInfo.days; day++) {
        let { shiftType, donReq, pts } = getShiftReqs(currDay, reqs);
        let temp = [];
        
        for (let p = 0; p < avails.length; p++) {
            if (avails[p][day] !== Availabilities.NOT_AVAILABLE) {
                temp.push(p)
            }
        }
        if (temp.length > 0 && temp.length <= donReq) {
            for (const p of temp) {
                const onCall = new Shift(people[p].name, shiftType, day);
                schedule[day].push(onCall);
                people[p].shifts.push(onCall);
                people[p].points += pts;
                for (let i = 0; i < sortedDonPrefs.length; i++) {   // Find array in sorted preferences representing this don
                    if (sortedDonPrefs[i][0] === p) {
                        // donPref[2].filter(d => d !== day);
                        sortedDonPrefs[i][1]--;
                    }
                }
            }
        }
        currDay = (currDay+1) % 7;
        // console.log(`Day: ${day}`, temp);
    }
    console.log("WERE ANY EXCLUSIVE SHIFTS ASSIGNED??");
    console.log(JSON.parse(JSON.stringify(schedule)));
    console.log(JSON.parse(JSON.stringify(people)));
    
    // Assigns shifts based on preferred days while spreading out shifts
    const float = Math.floor((reqs.monthInfo.days-3) / pointsPerPerson);
    assignShiftsOnPreferred(schedule, people, sortedDonPrefs, avails, reqs, pointsPerPerson, { float: float });

    // Do it again without a spread in an attempt to fill any holes
    assignShiftsOnPreferred(schedule, people, sortedDonPrefs, avails, reqs, pointsPerPerson);

    console.log("Status after only considering preferred: ");
    console.log(JSON.parse(JSON.stringify(schedule)));
    console.log(JSON.parse(JSON.stringify(people)));

    // Do it again also scheduling not preferred status in an attempt to fill any holes
    assignShiftsOnPreferred(schedule, people, sortedDonPrefs, avails, reqs, pointsPerPerson, { allowNotPreferred: true });

    console.log("Status after considering not preferred: ");
    console.log(JSON.parse(JSON.stringify(schedule)));
    console.log(JSON.parse(JSON.stringify(people)));
    
    // Look at `lower number of shifts people` in an attempt to fill any holes with weekday shifts
    assignShiftsOnPreferred(schedule, people, sortedDonPrefs, avails, reqs, pointsPerPerson+1, { useLowerShiftThrshld: true, onlyFillWeekdays: true });
    
    // Same thing but filling weekends too
    assignShiftsOnPreferred(schedule, people, sortedDonPrefs, avails, reqs, pointsPerPerson+1, { useLowerShiftThrshld: true });
    
    // Now consider assigning not preferred status to people with less shifts
    assignShiftsOnPreferred(schedule, people, sortedDonPrefs, avails, reqs, pointsPerPerson+1, { allowNotPreferred: true, useLowerShiftThrshld: true });
    
    return schedule;
}

/**
 * Generates an array of arrays representing a don's preferred days to work, along with their index in the initial array of people.
 * The returned array is sorted based on the second element of the inner arrays using insertion sort.
 * 
 * @param {Array<Person>} people Array of `Person` objects.
 * @param {Array<Array<string>>} avails 2D array of strings representing the availability of each person.
 * @param {Object} reqs Custom object containing various scheduling requirements and constraints.
 * @returns {Array<Array>} A sorted array with elements of the form `[indexInPeople, countOfPrefDays, prefDays, 0]`.
 */
function genSortedDonPrefs(people, avails, reqs) {
    // Rank people based on least to most # of preferred days
    const sortedDonPrefs = [];
    for (let persIdx = people.length-1; persIdx >= 0; persIdx--) {
        let count = 0;
        let prefDays = [];
        for (let day = 1; day <= reqs.monthInfo.days; day++) {
            if (avails[persIdx][day] === Availabilities.PREFERRED) {
                count++;
                prefDays.push(day)
            }
        }
        // sortedDonPrefs.push([count, persIdx, prefDays, float]);
        sortedDonPrefs.push([persIdx, count, prefDays, 0]);
    }
    sortTupleLike(sortedDonPrefs);
    return sortedDonPrefs;
}


/**
 * Sorts an array of arrays based on the second element of the inner arrays using insertion sort.
 * 
 * @param {Array<Array>} tupleArr The Array of Arrays to be sorted, based on the second element of the inner arrays.
 */
function sortTupleLike(tupleArr) {
    for (let i = 1; i < tupleArr.length; i++) {
        let cur = tupleArr[i];
        let j = i;
        while (cur[1] < tupleArr[j-1][1]) {
            tupleArr[j] = tupleArr[j-1];
            j -= 1;
            if (j <= 0) { break }
        }
        if (i != j) { tupleArr[j] = cur }
    }
}



/**
 * Determines the on-call shift type, number of required dons, and how many points this shift is worth. Returns these variables as an object
 * to be destructured.
 * 
 * @param {number} day Array of `Person` objects.
 * @param {Object} reqs Custom object containing various scheduling requirements and constraints.
 * @returns {Array<Array>} Object of the form `{ shiftType, donReq, pts }`.
 */
function getShiftReqs(day, reqs) {
    // Determine shift type and required dons this day
    
    let shiftType, donReq, pts;
    if (day < 5) {
        shiftType = ShiftTypes.ON_CALL_WKDAY;
        pts = reqs.points.onCallWeekday;
        if (day === 4) { donReq = reqs.numDons.onCallThurs; }
        else { donReq = reqs.numDons.onCallSunToWed; }
    } else {
        shiftType = ShiftTypes.ON_CALL_WKEND;
        pts = reqs.points.onCallWeekend;
        donReq = reqs.numDons.onCallFriToSat;
    }
    return { shiftType, donReq, pts }
}


function assignShiftsOnPreferred(schedule, people, sortedDonPrefs, avails, reqs, pointsPerPerson, 
  { float=0, allowNotPreferred=false, useLowerShiftThrshld=false, onlyFillWeekdays=false }={}) {
    let loop;
    useLowerShiftThrshld ? loop = 2 : loop = 1; 

    for (let iter = 0; iter < loop; iter++) {
        // Reset float
        for (const donPref of sortedDonPrefs) {
            donPref[3] = 0;
        }
        
        let currDay = reqs.monthInfo.firstDay;
        let threshold;
        if (useLowerShiftThrshld) {
            threshold = Math.floor((0.65+0.15*iter)*pointsPerPerson);
        }
        
        for (let day = 1; day <= reqs.monthInfo.days; day++) {
            let { shiftType, donReq, pts } = getShiftReqs(currDay, reqs);
            
            for (let donPrefIdx = 0; donPrefIdx < sortedDonPrefs.length; donPrefIdx++) {
                if (schedule[day].length < donReq) {
                    const donPref = sortedDonPrefs[donPrefIdx];
                    const donIdx = donPref[0];
                    const notPref = allowNotPreferred && (avails[donIdx][day] === Availabilities.NOT_AVAILABLE);
                    let underThreshold;
                    !useLowerShiftThrshld ? underThreshold = people[donIdx].points < pointsPerPerson 
                    : underThreshold = people[donIdx].shifts.length < threshold;
                    if (onlyFillWeekdays) {
                        underThreshold = (people[donIdx].points + pts <= pointsPerPerson) && (shiftType == ShiftTypes.ON_CALL_WKDAY);
                    }
                    if ((donPref[2].includes(day) || notPref) && underThreshold && donPref[3] == 0) {
                        const onCall = new Shift(people[donIdx].name, shiftType, day);
                        schedule[day].push(onCall);
                        people[donIdx].shifts.push(onCall);
                        people[donIdx].points += pts;
                        // donPref[2].filter(d => d !== day);
                        // donPref[1]--;
                        donPref[3] = float;
                    }
                } else { break; }
            }
            sortTupleLike(sortedDonPrefs);
            sortedDonPrefs.map(arr => {
                if (arr[3] > 0) { arr[3]--; }
                return arr;
            });
            currDay = (currDay+1) % 7;
        }
    }
}


function balanceShifts(schedule, people, avails, reqs) {

}

/**
 * Sorts an array of arrays based on the second element of the inner arrays using insertion sort.
 * 
 * @param {Array<Array>} tupleArr The Array of Arrays to be sorted, based on the second element of the inner arrays.
 */
function sortDonShifts(shifts) {
    for (let i = 1; i < shifts.length; i++) {
        let cur = shifts[i];
        let j = i;
        while (cur.day < shifts[j-1].day) {
            shifts[j] = shifts[j-1];
            j -= 1;
            if (j <= 0) { break }
        }
        if (i != j) { shifts[j] = cur }
    }
}

/**
 * Generates .csv file content.
 * 
 * @param {Array<Person>} people Array of `Person` objects, where each object has a person's Shifts and points.
 * @returns {string} The generated content as a string, ready to be turned into a .csv file.
 */
function generateCSVContent(schedule, people) {
    const days = schedule.length - 1;
    // const days = 4;
    
    // Create header row
    const dayColHeaders = [...new Array(days)].map((_, i) => i+1);
    let csv = 'Name,' + dayColHeaders.join(',') + '' + '\n';
    
    // Create data rows
    people.forEach(don => {
        let row = `${don.name},`;
        
        // Fill in shifts for each don
        let lastShiftDay = 0;
        sortDonShifts(don.shifts);
        for (const shift of don.shifts) {
            row += ','.repeat(shift.day-lastShiftDay-1);
            shift.day === days ? row += shift.type : row += `${shift.type},`;
            lastShiftDay = shift.day;
        }
        if (lastShiftDay !== days) { row += ','.repeat(days-lastShiftDay-1); }
        csv += row + '\n';
    });
    
    return csv;
}


/**
 * Generates .csv file content.
 * 
 * @param {Array<Person>} people Array of `Person` objects, where each object has a person's Shifts and points.
 * @returns {string} The generated content as a string, ready to be turned into a .csv file.
 */
function downloadCSV(csvContent, fileName) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const downloadBtn = document.createElement('button');
    downloadBtn.classList.add('download-btn');
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', fileName);      // Set name of download
    link.textContent = fileName;  
    downloadBtn.textContent = 'Generation was successful: ';
    downloadBtn.appendChild(link);
    output.appendChild(downloadBtn);
    
    // downloadBtn.style.visibility = 'hidden';
    //   downloadBtn.click();
    // document.body.removeChild(downloadBtn);
    // URL.revokeObjectURL(url);
}


document.getElementById('uploadButton').addEventListener('click', async function () {
    const fileInput = document.getElementById('csvFileInput');
    const output = document.getElementById('output');
    const file = fileInput.files[0];

    if (!file) {
        output.textContent = 'Please select a CSV file first.';
        return;
    }

    try {
        const peopleAvails = await handleInputCSV(file);
        
        // Get problem requirements
        const requirements = gatherRequirements();
        
        // Set up data structures
        peopleAvails.shift();   // Remove headers
        const people = []       // ith person's avail is in ith row of peopleAvails
        for (let i = 0; i < peopleAvails.length; i++) {
            peopleAvails[i].shift();    // Remove timestamps
            people.push(new Person(peopleAvails[i][0]));    // Name column is known to be here
        } 

        console.log('-------- Initial Information --------');
        console.log(peopleAvails);
        console.log(JSON.parse(JSON.stringify(people)));
        console.log(requirements.monthInfo.numWeekends + " weekends");
        console.log(requirements.monthInfo.numThurs + " thursdays");
        console.log('-------------------------------------');
        
        // Assign Shifts
        const schedule = assignShifts(people, peopleAvails, requirements);
        console.log(schedule);
        console.log(people);

        // Generate CSV Content
        const csvContent = generateCSVContent(schedule, people);
        // console.log(csvContent);

        // Prep for download
        downloadCSV(csvContent, 'schedule.csv');

    } catch(error) {
        console.log(error);
        output.textContent = error;
        return;
    }
});