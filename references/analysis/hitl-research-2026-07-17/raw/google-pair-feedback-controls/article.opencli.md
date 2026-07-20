# People + AI Guidebook
> 原文链接: https://pair.withgoogle.com/guidebook-v2/chapter/feedback-controls/

---

menu

# Feedback + Control

# When users give feedback to AI products, it can greatly improve the AI performance and the user experience over time. This chapter covers:

-   How should the AI request and respond to user feedback?
-   How can we ensure our AI can interpret and use both implicit and explicit user feedback?
-   What’s the right level of control and customization to give our users?

Want to drive discussions, speed iteration, and avoid pitfalls? [Use the worksheet](https://art-analytics.appspot.com/r.html?uaid=UA-139355838-1&utm_source=aRT-feedback&utm_medium=aRT-clicks&utm_campaign=feedback&destination=feedback&url=https%3A%2F%2Fpair.withgoogle.com%2Fworksheet%2Ffeedback-control.pdf).

Want to read the chapter offline? [Download PDF](https://pair.withgoogle.com/guidebook-v2/chapter/People%20+%20AI%20Guidebook%20-%20Feedback%20+%20Control.pdf)

# What’s new when working with AI

User feedback is the communication channel between your users, your product, and your team. Leveraging feedback is a powerful and scalable way to improve your technology, provide personalized content, and enhance the user experience.

For AI products, user feedback and control are critical to improving your underlying AI model’s output and user experience. When users have the opportunity to offer feedback, they can play a direct role in personalizing their experiences and maximizing the benefit your product brings to them. When users have the right level of control over the system, they’re more likely to trust it.

Key considerations for feedback and control mechanisms:

[**➀ Align feedback with model improvement**](#section1). Clarify the differences between implicit and explicit feedback, and ask useful questions at the right level of detail.

[**➁ Communicate value & time to impact**](#section2). Understand why people give feedback so you can set expectations for how and when it will improve their user experience.

[**➂ Balance control & automation**](#section3). Give users control over certain aspects of the experience and allow them to easily opt out of giving feedback.

## ➀ Align feedback with model improvement

In general, there are [implicit](https://pair.withgoogle.com/guidebook-v2/chapter/glossary/#implicit-feedback) and [explicit](https://pair.withgoogle.com/guidebook-v2/chapter/glossary/#explicit-feedback) mechanisms for gathering feedback. For either type of feedback, it’s important to let users know what information is being collected, what it’s for, and how its use benefits them. Whenever possible, find ways to use feedback to improve your AI.

### Review implicit feedback

Implicit feedback is data about user behavior and interactions from your product logs. This feedback can include valuable nuggets such as the times of day when users open your app, or the number of times they accept or reject your recommendations. Often, this happens as part of regular product usage — you don’t have to explicitly ask for this type of information, but you should let users know you’re collecting it, and get their permission up front.

We’ve talked about privacy a bit in [Mental Models](https://pair.withgoogle.com/guidebook-v2/chapter/mental-models/) and [Data Collection + Evaluation](https://pair.withgoogle.com/guidebook-v2/chapter/data-collection/). Users aren’t always aware of when their actions are being used as input or feedback, so be sure to review the considerations in the [Explainability + Trust](https://pair.withgoogle.com/guidebook-v2/chapter/explainability-trust/) and [Mental Models](https://pair.withgoogle.com/guidebook-v2/chapter/mental-models/) chapters when explaining how you’ll use this data. In particular, you should allow users to opt out of certain aspects of sharing implicit feedback — like having their behavior logged — and this should be included in your terms of service.

![RUN app screenshot: 'Review your past runs, change data collection settings, or opt out of data collection in Run history.' ](images/img_001.png)

_check\_circle\_outline_ Aim for

Let the user know where they can see their data and where they can change data-collection settings. Ideally, do this in-context. [Learn more](https://pair.withgoogle.com/guidebook-v2/chapter/user-needs/#section1)

![RUN app screenshot: 'Revew your past runs under run history.' ](images/img_002.png)

_not\_interested_ Avoid

Don’t implicitly collect data without telling people. Always provide a way to see, and ideally edit, data collected.

### Collect explicit feedback

Explicit feedback is when users deliberately provide commentary on output from your AI. Often, this is qualitative, like whether or not a recommendation was helpful, or if and how a categorization — such as a photo label — was wrong. This can take many forms such as surveys, ratings, thumbs up or down, or open text fields.

The question and answer choices you provide in explicit feedback should be easy for users to understand. It’s also important that your wording choices hit the appropriate voice and tone for the type of feedback you’re requesting, and avoid words or references that can be interpreted as offensive. Jokes most likely aren’t appropriate when asking about something serious.

Explicit feedback can be used in two ways:

1.  You or your team can review user feedback for themes and make changes to the product accordingly.
2.  It can be fed directly back into the AI model as a signal.

If you’re building for the latter, make sure that the feedback data you receive can actually be used to improve your model. Both your system and your users should understand what the feedback means.

In most cases, options for feedback responses should be mutually exclusive and collectively exhaustive. For example, thumbs up versus a thumbs down is unambiguous (“yay” or “nay”), mutually exclusive (not “yay and nay”), and covers the full range of useful opinions (“meh” isn’t very actionable). For more granular feedback, show options that match with the way that users evaluate their experiences.

### Interpret dual feedback

Sometimes a single piece of feedback contains both implicit and explicit signals at the same time. For example, public ‘likes’ are both a way to communicate with others (explicitly) and useful data to tune a recommendations model (implicitly). Feedback like this can be confusing because there isn’t always a clear link between what a user does and what a user wants from the AI model. For example, just because someone interacts with a piece of content doesn’t mean they want to see more of the same. They could be trying to dismiss it — or giving in to a temporary curiosity.

In these cases, it’s important to consider how you’ll use the implicit signal for model tuning. Not every action can be interpreted in the same way. Similarly, if explicit feedback can have a wide interpretation, say from “this is OK” to “this is the best thing ever and all I want to see are things like this from now on”, consider decreasing how it impacts tuning the model.

### Design for model tuning

Ideally, what people want to give feedback on aligns with what data is useful to tune your model. However, that’s not guaranteed. Find out what people expect to be able to influence by conducting user research. For example, when using a video recommender system, people may want to give feedback at a different conceptual level than the AI model understands. They may think “show me more videos about parenthood” while the model interprets “show me more videos by this creator”.

Discuss with your cross-functional stakeholders all the tradeoffs of collecting or not collecting different types of feedback. Strong, unequivocal signals are great for tuning, but be thoughtful in how you surmise intent based on behavior. Sometimes, looking at interactions over a longer period of time can help you distill more accurate patterns of behavior and intent.

### Key concept

List out as many events and corresponding feedback opportunities as possible that could provide data to improve the AI in your product. Cast a wide net - App Store reviews, Twitter, email, call centers, push notifications, etc. Then, systematically ask what your users and data are telling you about your product’s experience.

1.  What user experience is triggering this feedback opportunity?
2.  What kind of content are they providing feedback on?
3.  Is this feedback implicit or explicit?

Apply the concepts from this section in Exercise 1 [in the worksheet](https://art-analytics.appspot.com/r.html?uaid=UA-139355838-1&utm_source=aRT-feedback&utm_medium=aRT-clicks&utm_campaign=feedback&destination=feedback&url=https%3A%2F%2Fpair.withgoogle.com%2Fworksheet%2Ffeedback-control.pdf)

## ➁ Communicate value & time to impact

For people to take the time to give feedback, it needs to be valuable and impactful. How you communicate this is key to whether or not your users will engage. Keep in mind that “value” is often tied to motivation, so frame your feedback requests in terms of specific user benefits.

Before we get into messaging considerations for communicating the user benefit of feedback, let’s start with why people give feedback in the first place.

### Understand why people give feedback

There are many reasons people choose to give feedback about a product or experience. Here are a few of the canonical reasons along with the pros and cons of each.

### Material rewards

Cash payments are highly motivating. [Mechanical Turk](https://www.mturk.com/) is an example of this type of reward for feedback at scale.

#### Pros

-   A direct solution to increase feedback
-   May increase the volume of feedback

#### Cons

-   Costly to run over time
-   May devalue intrinsic motivations
-   Biases for a subset of users
-   May decrease feedback quality

### Symbolic rewards

These can include status attainment, such as virtual badges, social proof and group status by projecting a self image to a community, and social capital, such as a reputation as an expert.

#### Pros

-   Low to no cost

#### Cons

-   Relies on users caring about how they’re perceived
-   Creates power imbalances in the community
-   May inhibit intrinsic motivation

### Personal utility

These include “quantified self” experiences including allowing users to track their progress, bookmark things for later, and explicitly training a personalized AI model — like a recommendation engine— for more relevant output later on.

#### Pros

-   No network effects or community necessary to begin

#### Cons

-   Privacy does not support community development
-   May inhibit intrinsic motivation

### Altruism

Altruistic motivations can include community building and helping other people make decisions, such as leaving a product review, as well as trying to increase fairness, like giving a conflicting opinion by disagreeing with a particular product review.

#### Pros

-   Potential for more honest feedback based on a desire to help

#### Cons

-   Social desirability biases may lead to extremes in feedback content
-   Decrease in contributions if the opinion is already represented
-   Altruism levels may vary across cultures or groups

### Intrinsic motivation

Intrinsic motivation is the internal fulfillment people get from the act of expressing themselves. This includes direct enjoyment from giving feedback, the ability to vent and express opinions, and the enjoyment of community participation.

#### Pros

-   No network effects or community needed to start
-   People like to do things they enjoy

#### Cons

-   Social desirability biases may lead to extremes in feedback content

### Align perceived and actual user value

If the benefit isn’t clear and specific, users may not understand why they should give feedback. They might avoid giving feedback, or if they can’t avoid it, they could give meaningless responses, or feedback that ends up being harmful to your product or community.

If the user thinks their feedback is only valuable to the product developers, some might decide purposefully give bad feedback. For example, if users assume that the intent behind your “free” app is actually to collect data to sell to advertisers without telling them, this could color the feedback they give in surveys.

Ideally, users will understand the value of their feedback and will see it manifest in the product in a recognizable way. It’s up to you to connect the value users think they’re getting with what your AI can actually deliver.

### Connect feedback to user experience changes

Simply acknowledging that you received a user’s feedback can build trust, but ideally the product will also let them know what the system will do next, or how their input will influence the AI.

It’s not always possible to communicate specifically when and how a user’s feedback will change their individual experience. But if you do, make sure your product can deliver on the timeline you promise. If you can, let users give feedback that has an impact right away.

Here are some approaches for describing feedback timing and impact:

#### 1\. “Thanks for your feedback”

-   Impact timing: None
-   Scope: None

#### 2\. “Thanks! Your feedback helps us improve future run recommendations”

-   Impact timing: “future” broadly
-   Scope: All users’ “recommendations”

#### 3\. “Thanks! We’ll improve your future run recommendations”

-   Impact timing: “future” broadly
-   Scope: Your “recommendations”

#### 4\. “Thanks! Your next run recommendation won’t include hills”

-   Impact timing: “next”. This is a bit vague, unless there’s an established cadence.
-   Scope: “Hills” category

#### 5\. “Thanks. We’ve updated your recommendations. Take a look”

-   Impact timing: “We’ve updated” implies immediately
-   Scope: Demonstrated content updates

<video src="https://pair.withgoogle.com/guidebook-v2/legacy-guidebook-assets/assets/FC4_aim-for_720.mp4" controls poster="https://pair.withgoogle.com/guidebook-v2/legacy-guidebook-assets/assets/FC4_aim-for_720.png"></video>

_play\_circle\_filled_

_check\_circle\_outline_ Aim for

Acknowledge user feedback and adjust immediately—or let users know when adjustments will happen. [Learn more](https://pair.withgoogle.com/guidebook-v2/chapter/user-needs/#section1)

<video src="https://pair.withgoogle.com/guidebook-v2/legacy-guidebook-assets/assets/FC4_avoid_720.mp4" controls poster="https://pair.withgoogle.com/guidebook-v2/legacy-guidebook-assets/assets/FC4_avoid_720.png"></video>

_play\_circle\_filled_

_not\_interested_ Avoid

Don’t just thank users—reveal how feedback will benefit them. They’ll be more likely to give feedback again.

### Set expectations for AI improvements

For many systems, even with user feedback, much of the AI output is likely to be the same as it was before. As a user provides more and more feedback, each piece will likely have less of an effect on the AI model. It’s also possible the improvements you make to your model will be too subtle for your users to register right away.

Sometimes feedback isn’t connected to improving the AI model at all. For example, a product may include a “show more/less of this” feedback button as part of recommendations, but that feedback may not be used to tune the AI model. It could simply be a filter on what content is shown and not have any impact on future recommendations. If this is the case, and users have a mental model of immediate tuning, this can create mismatched expectations and your users could be confused, disappointed, and frustrated.

To avoid this situation, you can use the messaging examples above to make sure the feedback scope and time to impact are clear. The user experience will be better if users know how long it will take for your model to adjust to their needs.

Even with the best data and feedback, AI model improvements are almost never possible to implement immediately. Your engineering team may need to wait to implement model updates until they have additional signals from an individual, more data from a group, or a version release.

The reality of these delays means you need to set clear expectations for when people should expect improvements to the model’s performance or better output relevance from your AI-powered product. You can do this with clear design and messaging.

### Key concept

When thinking about opportunities to ask for user feedback, think about how and when it will improve their experience with the AI. Ask yourself the following questions about each feedback request:

1.  Do all of your user groups benefit from this feedback?
2.  How might the user’s level of control over the AI influence their willingness to provide feedback?
3.  How will the AI change based on this feedback?
4.  When will the AI change based on this feedback?

Apply the concepts from this section in Exercise 2 [in the worksheet](https://art-analytics.appspot.com/r.html?uaid=UA-139355838-1&utm_source=aRT-feedback&utm_medium=aRT-clicks&utm_campaign=feedback&destination=feedback&url=https%3A%2F%2Fpair.withgoogle.com%2Fworksheet%2Ffeedback-control.pdf)

## ➂ Balance control & automation

For AI-driven products, there’s an essential balance between automation and user control. Your product won’t be perfect for every user, every time, so allow users to adapt the output to their needs, edit it, or turn it off. Their context in the real world, and their relationship with the task at hand dictates how they use your product. We talk more about whether or not to [automate](https://pair.withgoogle.com/guidebook-v2/chapter/glossary/#automate) tasks or [augment](https://pair.withgoogle.com/guidebook-v2/chapter/glossary/#augment) processes in the chapter on [User Needs + Defining Success](https://pair.withgoogle.com/guidebook-v2/chapter/user-needs/).

### Understand when people want to maintain control

When building AI-powered products, it’s tempting to assume that the most valuable product is one that automates a task that people currently do manually. This could be taking a process that currently requires seven steps to complete, and compressing it into one command. For example, imagine a music app that could generate themed song collections, so users don’t have to take the time to review artists, listen to tracks, decide, and then compile the song list.

The user benefit in products like these may seem obvious, but the teams who make these products typically learn valuable lessons about how users feel about automation and control. There are some predictable situations when people prefer to remain in control of task or process — whether it has AI or not. We talk more about whether or not to [automate](https://pair.withgoogle.com/guidebook-v2/chapter/glossary/#automate) tasks or [augment](https://pair.withgoogle.com/guidebook-v2/chapter/glossary/#augment) processes in the [User Needs + Defining Success](https://pair.withgoogle.com/guidebook-v2/chapter/user-needs/) chapter, but here’s a short refresher.

#### People enjoy the task

Not every task is a chore. If you enjoy doing something, you probably don’t want to automate the entire process.

#### People feel personally responsible for the outcome

For most small favors or personal exchanges, people prefer to remain in control and responsible to fulfill the social obligations they take on.

#### The stakes of the situation are high

People typically like to remain accountable for physical stakes such as safety or health, emotional stakes like expressing feelings, or financial stakes like sharing banking information.

#### Personal preferences are hard to communicate

In situations where people have a creative vision, many people prefer staying in control so they can maintain ownership and see their plan through to execution.

### Understand when people will give up control

There are of course plenty of times when people feel perfectly fine giving up control, and prefer the help of an AI or automated system.

#### When they are unable to do a task

Often people would do something if they knew how or had time, but don’t so they can’t. These limitations can be temporary.

#### When a task is unpleasant or unsafe

Most people would prefer to give up control to avoid tasks that require a significant effort or risk for little enjoyment or gain.

### Allow for opting out

When first introducing your AI, consider allowing users to test it out or turn it off. Once you’ve clearly explained the benefits, respect their decision not to use the feature. Keep in mind, they may decide to use it later.

For your product to augment human tasks and processes, people need to be able to control what it does based on their situation. One way to allow for this is to provide a way for users to complete their task the regular, non-automated way. As we mentioned in the [Mental Models](https://pair.withgoogle.com/guidebook-v2/chapter/mental-models/) chapter, the manual method is a safe and useful fallback. Because errors and failure are critical to improving your AI, your users will definitely need a manual failsafe, especially in the early days of using your product.

Keep in mind the relative priority of your product in the daily lives of your users. The people using your product are most likely multitasking, using other products or apps, and generally getting pulled in many directions. For example, for a navigation app, suggesting a faster alternate route while someone is driving could get them home more quickly, but if their attention is split between passengers and traffic conditions, it could be dangerous to use. Remember that your product likely isn’t the focus of your users’ lives, so keep engagement requests strategic, minimal, and allow for easy dismissal.

### Provide editability

A user’s preferences may change over time, so consider how you’ll give them control over what preferences they communicate to your ML model, and give them the ability to adjust it. Even if your system’s previous suggestion or prediction wasn’t relevant before, it may become relevant in the future. Your product should allow for people to erase or update their previous selections, or reset your ML model to the default, non-personalized version.

<video src="https://pair.withgoogle.com/guidebook-v2/legacy-guidebook-assets/assets/FC6_aim-for_720.mp4" controls poster="https://pair.withgoogle.com/guidebook-v2/legacy-guidebook-assets/assets/FC6_aim-for_720.png"></video>

_play\_circle\_filled_

_check\_circle\_outline_ Aim for

Allow users to adjust their prior feedback and reset the system. [Learn more](https://pair.withgoogle.com/guidebook-v2/chapter/user-needs/#section1)

### Key concept

Take time to think about your users’ expectations for control over certain tasks or processes. Here’s a quick checklist for you and your team to run through before setting up feedback and control mechanisms:

1.  Can your AI accommodate a wide range of user abilities and preferences?

2.  Does your AI deal with highly-sensitive domains, such as health, wealth, or relationships?
3.  Will your AI take a long time to get to the target level of accuracy and usefulness?
4.  Is your AI used in high-stakes situations, where it introduces a new mental model?

5.  Are there likely changes in the user’s needs that would require them to “reset” or otherwise “take over” for the model?

Apply the concepts from this section in Exercise 3 [in the worksheet](https://art-analytics.appspot.com/r.html?uaid=UA-139355838-1&utm_source=aRT-feedback&utm_medium=aRT-clicks&utm_campaign=feedback&destination=feedback&url=https%3A%2F%2Fpair.withgoogle.com%2Fworksheet%2Ffeedback-control.pdf)

## Summary

When building your AI-powered feature or product, feedback and user control are critical to developing communication and trust between your user and the system, and for developing a product that fulfills your users’ needs consistently over time. Feedback mechanisms partner closely with [Mental Models](https://pair.withgoogle.com/guidebook-v2/chapter/mental-models/), [Explainability + Trust](https://pair.withgoogle.com/guidebook-v2/chapter/explainability-trust/), and how you’ll tune your AI. These three aspects are key in improving your product for your users.

Remember when working with AI, there are three new considerations for feedback and control mechanisms:

[**➀ Align feedback with model improvement**](#section1). Clarifying the differences between [implicit](https://pair.withgoogle.com/guidebook-v2/chapter/glossary/#implicit-feedback) and [explicit](https://pair.withgoogle.com/guidebook-v2/chapter/glossary/#explicit-feedback) feedback, and asking the right questions at the right level of detail.

[**➁ Communicate value & time to impact**](#section2). Understanding why people give feedback, and building on existing mental models to explain benefits and communicate how user feedback will change their experience, and when.

[**➂ Balance control & automation**](#section3). Helping users control the aspects of the experience they want to, as well as easily opting out of giving feedback.

Want to drive discussions, speed iteration, and avoid pitfalls? [Use the worksheet](https://art-analytics.appspot.com/r.html?uaid=UA-139355838-1&utm_source=aRT-feedback&utm_medium=aRT-clicks&utm_campaign=feedback&destination=feedback&url=https%3A%2F%2Fpair.withgoogle.com%2Fworksheet%2Ffeedback-control.pdf)

_expand\_more_ _expand\_less_

## References

In addition to the academic and industry references listed below, recommendations, best practices, and examples in the People + AI Guidebook draw from dozens of Google user research studies and design explorations. The details of these are proprietary, so they are not included in this list.

-   Baxter, K. (2017, April 12). [How to Meet User Expectations for Artificial Intelligence](https://medium.com/salesforce-ux/how-to-meet-user-expectations-for-artificial-intelligence-a51d3c82af6)
-   Clapper, G. (2018, October 4). [Control and Simplicity in the Age of AI](https://design.google/library/control-and-simplicity/)
-   Culotta, A., Kristjansson, T., Mccallum, A., & Viola, P. (2006). Corrective feedback and persistent learning for information extraction. Artificial Intelligence,170(14-15), 1101-1122.
-   Dietvorst, B. J., Simmons, J. P., & Massey, C. (2015). Overcoming Algorithm Aversion: People Will Use Algorithms If They Can (Even Slightly) Modify Them. SSRN Electronic Journal.
-   Harley, A. (2018, September 30). [Individualized Recommendations: Users’ Expectations & Assumptions](https://www.nngroup.com/articles/recommendation-expectations/)
-   Harley, A. (2018, November 4). [UX Guidelines for Recommended Content](https://www.nngroup.com/articles/recommendation-guidelines/)
-   Jugovac, M., & Jannach, D. (2017). Interacting with Recommenders—Overview and Research Directions. ACM Transactions on Interactive Intelligent Systems,7(3), 1-46.
-   Parasuraman, R., & Riley, V. (1997). Humans and Automation: Use, Misuse, Disuse, Abuse. Human Factors: The Journal of Human Factors and Ergonomics Society.
-   Parra, Denis & Amatriain, Xavier. (2011). Walk the Talk - Analyzing the Relation between Implicit and Explicit Feedback for Preference Elicitation.. Nursing standard (Royal College of Nursing (Great Britain) :1987). 14. 255-268.
-   Stumpf, S., Rajaram, V., Li, L., Burnett, M., Dietterich, T., Sullivan, E., … Herlocker, J. (2007). Toward harnessing user feedback for machine learning. Proceedings of the 12th International Conference on Intelligent User Interfaces - IUI 07.
-   Szaszko, M. (2017, September 27). [UX design for implicit and explicit feedback in an AI product](https://becominghuman.ai/ux-design-for-implicit-and-explicit-feedback-in-an-ai-product-9497dce737ea)
-   Thomaz, A. L., Hoffman, G., & Breazeal, C. (2006). Experiments in socially guided machine learning. Proceeding of the 1st ACM SIGCHI/SIGART Conference on Human-robot Interaction - HRI 06.
-   Virtue, E. (2017, September 26). [Designing with AI](https://medium.com/elegant-tools/designing-with-ai-3f7652619f4)

Previous

 [![](images/img_003.svg) Explainability + Trust](https://pair.withgoogle.com/guidebook-v2/chapter/explainability-trust/)

Next

 [![](images/img_004.svg) Errors + Graceful Failure](https://pair.withgoogle.com/guidebook-v2/chapter/errors-failing/)

[![Creative Commons License](images/img_005.png)](http://creativecommons.org/licenses/by-nc-sa/4.0/)
People + AI Guidebook by [People + AI Research team](https://pair.withgoogle.com/) is licensed under a [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License](http://creativecommons.org/licenses/by-nc-sa/4.0/).
Based on a work at [pair.withgoogle.com](https://pair.withgoogle.com/).
