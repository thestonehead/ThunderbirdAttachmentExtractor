browser.menus.create({
  id: "extract-attachments",
  title: "Extract attachments",
  contexts: ["message_list"]
}, onCreated);


browser.menus.onClicked.addListener(onClicked);

async function onClicked(info, tab){
	if (info.menuItemId != "extract-attachments")
		return;
	
	// Load a message list
	const messages = await browser.mailTabs.getSelectedMessages(tab.id);

	var allMessages = [];
	// Helper inline function for getting attachment details from a message
	const createMessage = async function(message){
		const attachments = await browser.messages.listAttachments(message.id);
		return {
			id: message.id,
			account: message.folder.accountId,
			folder: message.folder.path,
			attachments: attachments
		};
	}
	// Iterate through all messages
	for(let m of messages.messages){
		allMessages.push(await createMessage(m));
	}
	while (messages.id){
		for(let m of messages.messages){
			allMessages.push(await createMessage(m));
		}
	}
	// Call Experiment API to detach attachments from selected messages
	await browser.attachmentExtractorApi.detachAttachmentsFromSelectedMessages(allMessages);
}


function onCreated() {
}

