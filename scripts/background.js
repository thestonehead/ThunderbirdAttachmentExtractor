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
	for (let part of parts || []) {
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
const getMessageAttachmentDetails = async function(message){
	return {
		message,
		attachments: await browser.messages.listAttachments(message.id),
		full: await browser.messages.getFull(message.id),
	};
}

async function onClicked(info, tab){
	if (info.menuItemId != "extract-attachments" && info.menuItemId != "delete-attachments") {
		return;
	}
	
	var allMessageAttachmentDetails = [];

	// Get first page of messages
	let currentPage = info.selectedMessages;
	if (currentPage.messages.length == 0){
		browser.attachmentExtractorApi.showAlertToUser("Oops", "No message selected. Please select a message (or multiple) with an attachment.");
		return;
	}
	
	// Iterate through the messages
	for (let m of currentPage.messages) {
		allMessageAttachmentDetails.push(await getMessageAttachmentDetails(m));
	}
	// As long as there is an ID, more pages can be fetched
	while (currentPage.id) {
		currentPage = await browser.messages.continueList(currentPage.id);
		for (let m of currentPage.messages) {
			allMessageAttachmentDetails.push(await getMessageAttachmentDetails(m));
		}
	}

	if (info.menuItemId == "extract-attachments") {
		// Call Experiment API to detach attachments from selected messages
		await browser.attachmentExtractorApi.detachAttachmentsFromSelectedMessages(
			allMessageAttachmentDetails
		);
	}
	else if (info.menuItemId == "delete-attachments") {
		const deletableAttachmentDetails = allMessageAttachmentDetails.flatMap(d => {
			if (d.message.external) {
				return [];
			}
			const deletableAttachments = d.attachments.flatMap(a => {
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
			return deletableAttachments.length > 0
				? [{ message: d.message, attachments: deletableAttachments }]
				: []
		});
		if (deletableAttachmentDetails.length == 0) {
			browser.attachmentExtractorApi.showAlertToUser(
				"Oops",
				"No deletable attachments found."
			);
			return;
		}
		if (await browser.attachmentExtractorApi.showPromptToUser(
				`Delete attachments`, 
				`Do you wish to delete these attachments from your e-mails? (Irreversible!)\n - ${
					deletableAttachmentDetails.map(d => d.attachments.map(a => a.name)).flat().join("\n - ")
				}`
		)) {
			for (let messageDetail of deletableAttachmentDetails) {
				await browser.messages.deleteAttachments(
					messageDetail.message.id,
					messageDetail.attachments.map(a => a.partName)
				);
			}
			browser.attachmentExtractorApi.showAlertToUser("Delete attachments", "The requested attachments have been deleted.");
		}
	} else {
		browser.attachmentExtractorApi.showAlertToUser("Oops", "Unknown action.");
	}
	
}

function onCreated() {
}
