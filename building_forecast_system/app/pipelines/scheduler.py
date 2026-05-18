from apscheduler.schedulers.blocking import BlockingScheduler
from apscheduler.triggers.cron import CronTrigger

from app.pipelines.run_retraining_cycle import run as run_retraining_cycle
from app.pipelines.run_short_inference import run as run_short_inference
from app.pipelines.run_global_short_inference import run as run_global_short_inference
from app.pipelines.run_global_long_inference import run as run_global_long_inference
from app.pipelines.fetch_weather_openmeteo import main as run_fetch_weather


def main():

    scheduler = BlockingScheduler(timezone="Europe/Sofia")

    # Every hour: fetch weather forecast (Open-Meteo)
    scheduler.add_job(
        run_fetch_weather,
        CronTrigger(minute=0),  # runs at the start of every hour
        id="fetch_weather",
        replace_existing=True,
        max_instances=1,
    )

    # Once a week: relearn everything
    scheduler.add_job(
        run_retraining_cycle,
        CronTrigger(day_of_week="sun", hour=2, minute=0),
        id="retraining_cycle",
        replace_existing=True,
        max_instances=1,
    )

    # Every day: make short guesses for all normal circuits
    scheduler.add_job(
        run_short_inference,
        CronTrigger(hour=3, minute=15),
        id="short_inference",
        replace_existing=True,
        max_instances=1,
    )

    # Every day: make the global short guess
    scheduler.add_job(
        run_global_short_inference,
        CronTrigger(hour=3, minute=20),
        id="global_short_inference",
        replace_existing=True,
        max_instances=1,
    )

    # Every Sunday: make the global long guess
    scheduler.add_job(
        run_global_long_inference,
        CronTrigger(day_of_week="sun", hour=3, minute=30),
        id="global_long_inference",
        replace_existing=True,
        max_instances=1,
    )
   
    print("Scheduler started.")
    print("Jobs:")
    for job in scheduler.get_jobs():
        print(f" - {job.id}: {job.trigger}")

    scheduler.start()


if __name__ == "__main__":
    main()