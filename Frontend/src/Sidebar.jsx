import "./Sidebar.css";
import { useContext, useEffect } from "react";
import { MyContext } from "./MyContext.jsx";
import {v1 as uuidv1} from "uuid";
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL;
const authHeaders = () => ({ Authorization: `Bearer ${localStorage.getItem("token")}` });

function Sidebar() {
    const {allThreads, setAllThreads, currThreadId, setNewChat, setPrompt, setReply, setCurrThreadId, setPrevChats,isSidebarOpen,setIsSidebarOpen} = useContext(MyContext);

    const getAllThreads = async () => {
        // Logged out -> no threads to show (each chat belongs to a logged-in user)
        if (!localStorage.getItem("token")) {
            setAllThreads([]);
            return;
        }
        try {
            const response = await fetch(`${BACKEND_URL}/api/thread`, { headers: authHeaders() });
            const res = await response.json();
            if (!Array.isArray(res)) { setAllThreads([]); return; }
            const filteredData = res.map(thread => ({threadId: thread.threadId, title: thread.title}));
            //console.log(filteredData);
            setAllThreads(filteredData);
        } catch(err) {
            console.log(err);
        }
    };

    useEffect(() => {
        getAllThreads();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currThreadId]);


    const createNewChat = () => {
        setNewChat(true);
        setPrompt("");
        setReply(null);
        setCurrThreadId(uuidv1());
        setPrevChats([]);
        setIsSidebarOpen(false);
    }

    const changeThread = async (newThreadId) => {
        setCurrThreadId(newThreadId);
        setIsSidebarOpen(false);

        try {
            const response = await fetch(`${BACKEND_URL}/api/thread/${newThreadId}`, { headers: authHeaders() });
            const res = await response.json();
            if (!Array.isArray(res)) return;
            setPrevChats(res);
            setNewChat(false);
            setReply(null);
        } catch(err) {
            console.log(err);
        }
    }   

    const deleteThread = async (threadId) => {
        try {
            const response = await fetch(`${BACKEND_URL}/api/thread/${threadId}`, {method: "DELETE", headers: authHeaders()});
            if (!response.ok) return; // not deleted on the server -> keep it in the list

            //updated threads re-render
            setAllThreads(prev => prev.filter(thread => thread.threadId !== threadId));

            if(threadId === currThreadId) {
                createNewChat();
            }

        } catch(err) {
            console.log(err);
        }
    }

    return (

        <section className={`sidebar ${isSidebarOpen ? "open" : ""}`}>
             
             
          
            <button onClick={createNewChat}>
                <small>New Chat......</small>
               
                <span><i className="fa-solid fa-pen-to-square"></i></span>
            </button>


            <ul className="history">
                {
                    allThreads?.map((thread, idx) => (
                        <li key={idx} 
                            onClick={() => changeThread(thread.threadId)}
                            className={thread.threadId === currThreadId ? "highlighted": " "}
                        >
                            {thread.title}
                            <i className="fa-solid fa-trash"
                                onClick={(e) => {
                                    e.stopPropagation(); //stop event bubbling
                                    deleteThread(thread.threadId);
                                }}
                            ></i>
                        </li>
                    ))
                }
            </ul>
 
            <div className="sign">
                <p>By &hearts; Abhay Verma </p>
            </div>
        </section>
        
    )
}

export default Sidebar;