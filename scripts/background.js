browser.menus.create({
  id: "extract-attachments",
  title: "Extract attachments",
  contexts: ["message_list"]
}, onCreated);
browser.menus.create({
  id: "delete-attachments",
  title: "Delete attachments",
  contexts: ["message_list"]
}, onCreated);


browser.menus.onClicked.addListener(onClicked);

/**
 * Helper function to find the full mime details of a part.
 */
function findPart(parts, partName) {
	for (const part of parts || []) {
		if (part.partName == partName) {
			return part;
		}
		const entry = findPart(part.parts, partName);
		if (entry) {
			return entry;
		}
	}
	return null;
}

/**
 * Helper function for getting attachment details from a message.
 */
const getMessageAttachmentDetails = async function(message) {
	const messageDetails = `for message ${message.date.toLocaleString()} "${message.subject}"`;
	return {
		message,
		attachments: await browser.messages.listAttachments(message.id).catch(e => {
			console.warn(`Failed to list attachments ${messageDetails}:`, e);
			return [];
		}),
		full: await browser.messages.getFull(message.id).catch(e => {
			console.warn(`Failed to get full message ${messageDetails}:`, e);
			return null;
		}),
	};
}

async function getAttachmentDetailsOfSelectedMessages(info) {
	let allMessageAttachmentDetails = [];

	// Get first page of messages
	let currentPage = info.selectedMessages;
	if (currentPage.messages.length == 0) {
		browser.attachmentExtractorApi.showAlertToUser("Oops", "No message selected. Please select a message (or multiple) with an attachment.");
		return;
	}

	// Iterate through the messages
	for (const m of currentPage.messages) {
		allMessageAttachmentDetails.push(await getMessageAttachmentDetails(m));
	}
	// As long as there is an ID, more pages can be fetched
	while (currentPage.id) {
		currentPage = await browser.messages.continueList(currentPage.id);
		for (const m of currentPage.messages) {
			allMessageAttachmentDetails.push(await getMessageAttachmentDetails(m));
		}
	}

	return allMessageAttachmentDetails;
}

async function getMessagesWithProcessableAttachments(allMessageAttachmentDetails) {
	return allMessageAttachmentDetails.flatMap(d => {
		if (d.message.external) {
			return [];
		}
		const processableAttachments = d.attachments.flatMap(a => {
			// Bug 1910336. This information should be exposed on the
			// attachments object directly, we should not have to search the
			// full mime details.
			const part = findPart(d.full.parts, a.partName);
			return (
				!part ||
				part.contentType == "text/x-moz-deleted" ||
				!part.headers ||
				part.headers["x-mozilla-external-attachment-url"]
			) ? [] : [a]
		});
		return processableAttachments.length > 0
			? [{ message: d.message, attachments: processableAttachments }]
			: []
	});
}

function getActionText(action) {
	switch (action) {
		case "extract-attachments":
			return "extractable";
		case "delete-attachments":
			return "deletable";
		default:
			return "processable";
	}
}

async function checkProcessableAttachments(allMessageAttachmentDetails, processableAttachmentDetails, action) {
	if (processableAttachmentDetails.length == 0) {
		browser.attachmentExtractorApi.showAlertToUser(
			"Oops",
			`No ${action} attachments found in selected messages.`
		);
		return false;
	}
	if (processableAttachmentDetails.length < allMessageAttachmentDetails.length) {
		await browser.attachmentExtractorApi.showAlertToUser(
			"Info",
			`Only ${processableAttachmentDetails.length} of your ${allMessageAttachmentDetails.length} selected messages contain ${action} attachments.`
		);
	}
	return true;
}

async function onClicked(info, tab){
	if (info.menuItemId != "extract-attachments" && info.menuItemId != "delete-attachments") {
		return;
	}

	const allMessageAttachmentDetails = await getAttachmentDetailsOfSelectedMessages(info);
	const processableAttachmentDetails = await getMessagesWithProcessableAttachments(allMessageAttachmentDetails);

	if (!await checkProcessableAttachments(allMessageAttachmentDetails, processableAttachmentDetails, getActionText(info.menuItemId))) {
		return;
	}

	if (info.menuItemId == "extract-attachments") {
		// Call several methods in Experiment API to extract attachments from selected messages
		try {
			// Ask user for preferred attachment filename format
			await browser.attachmentExtractorApi.askUserForFilenameFormat();

			// // Notify user about files that can't be saved
			// if (deletedFiles.length > 0) {
			// 	browser.attachmentExtractorApi.showAlertToUser("Some files can't be saved", "These files have already been deleted and cannot be saved:\n" + prepareFilesNamesForDisplaying(deletedFiles.flat()).join("\n"));
			// 	// Don't continue if all of the files are already deleted
			// 	if (types.flat().length == 0) {
			// 		return;
			// 	}
			// }

			if (!await browser.attachmentExtractorApi.askUserForDestinationFolder())
			{
				// console.debug("askUserForDestinationFolder did not return a valid folder.");
				return;
			}

			let break_loop = false;
			let counterSavedAttachments = 0;
			for (const messageDetail of processableAttachmentDetails) {
				for (const attachment of messageDetail.attachments) {
					// read attachment as file
					const attachedFile = await browser.messages.getAttachmentFile(
						messageDetail.message.id,
						attachment.partName
					)
					const filePath = await browser.attachmentExtractorApi.getFilePathForAttachment(messageDetail.message.id, attachment.name);

					const success = await browser.attachmentExtractorApi.saveFileTo(attachedFile, filePath);
					if (success) {
						counterSavedAttachments++;
					}
					else if (!await browser.attachmentExtractorApi.showPromptToUser("Save Attachments", "Could not save attachment. Do you still want to continue?")) {
						break_loop = true;
						break;
					}
				}
				if (break_loop) {
					break;
				}
			}
			browser.attachmentExtractorApi.showAlertToUser("Save Attachments", `In total ${counterSavedAttachments} attachments have been saved. Please check the selected folder.`);
		}
		catch (ex) {
			console.error(ex.toString());
			browser.attachmentExtractorApi.showAlertToUser("Error", ex.toString());
		}
	}
	else if (info.menuItemId == "delete-attachments") {
		listAttachmentsNames = processableAttachmentDetails.flatMap(d => d.attachments.map(a => a.name));
		if (await browser.attachmentExtractorApi.showPromptToUser(
				`Delete attachments`,
				`Do you wish to delete these attachments from your e-mails? (Irreversible!)\n - ${
					(await browser.attachmentExtractorApi.getListLimitedTo(listAttachmentsNames)).join("\n - ")
				}`
		)) {
			for (const messageDetail of processableAttachmentDetails) {
				await browser.messages.deleteAttachments(
					messageDetail.message.id,
					messageDetail.attachments.map(a => a.partName)
				);
			}
			browser.attachmentExtractorApi.showAlertToUser("Delete attachments", "The attachments of the selected e-mails have been deleted as requested.");
		}
	} else {
		console.warn(`Provided action '${info.menuItemId}' is not implemented.`);
		browser.attachmentExtractorApi.showAlertToUser("Oops", "Unknown action.");
	}

}

function onCreated() {
}
